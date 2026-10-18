import {randomUUID} from 'node:crypto';
import {vi} from 'vitest';
import {scheduleRegistry} from '@/lib/schedules';
import type {AlarmNotice, MailOutcome} from '@/lib/mailer';

// Stand-ins for the alarm path's two outside neighbours, for the unit tests (Story 1.13): a database that keeps alarms, notices and heartbeats the way
// api.raise_alarm, api.resolve_alarm, api.list_alarms, api.alarms_due_mail, api.record_alarm_notice, api.alarm_observations and api.record_heartbeat do
// (including the 24-hour email rule: the real functions are tested against the real database in tests/integration/alarms.test.ts), and a mail sender
// that records what it was given and answers from a script.
export const env = {NEXT_PUBLIC_SUPABASE_URL: 'http://127.0.0.1:54321', SUPABASE_SERVICE_ROLE_KEY: 'service-key-for-tests-only'};
export const HOUR = 3_600_000;
export const START = Date.parse('2026-10-17T08:00:00.000Z');
export const iso = (ms: number) => new Date(ms).toISOString();
export const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {status, headers: {'content-type': 'application/json'}});

type Alarm = {id: string; condition: string; subject: string | null; firstAt: number; latestAt: number; resolvedAt: number | null; detail: Record<string, unknown>};
type Notice = {alarmId: string; at: number; outcome: string; seq: number};
/** A claim: `api.alarms_due_mail` handed the alarm to a sender. Kept apart from the notices (which are the outcomes a sender records), as the page's list keeps them apart. */
type Claim = {alarmId: string; at: number; seq: number};

type Observed = {
  first_receipt_age: number | null;
  latest_receipt_age: number | null;
  first_heartbeat_age: number | null;
  latest_heartbeat_age: number | null;
  ledger_pending: number;
  ledger_oldest: number | null;
  unaccounted: number;
  tasks: {task: string; outcome: string; at: string; age: number}[];
};
/** Every task finished a minute ago, nothing pending, nothing wrong. */
export const calm = (): Observed => ({
  first_receipt_age: 50_000,
  latest_receipt_age: 60,
  first_heartbeat_age: 40_000,
  latest_heartbeat_age: 600,
  ledger_pending: 0,
  ledger_oldest: null,
  unaccounted: 0,
  tasks: scheduleRegistry.map((entry) => ({task: entry.task, outcome: 'ran', at: '2026-10-17T07:59:00.000Z', age: 60})),
});

export function fakeDatabase() {
  const clock = {now: START};
  const alarms: Alarm[] = [];
  const notices: Notice[] = [];
  const claims: Claim[] = [];
  let sequence = 0;
  const calls: string[] = [];
  const observed = {value: calm()};
  const heartbeats: {jti: string; kid: string}[] = [];
  const revokedKeys = new Set<string>();
  const fail: Record<string, (() => Response) | undefined> = {};
  const failOnce = new Set<string>();

  const open = (condition: string, subject: string | null) => alarms.find((alarm) => alarm.condition === condition && alarm.subject === subject && alarm.resolvedAt === null);
  const sent = (alarmId: string) => notices.filter((notice) => notice.alarmId === alarmId && notice.outcome === 'sent');
  /** A claim still holds: it is under 10 minutes old and no outcome has been recorded for its alarm since (a notice made later than it). */
  const holding = (claim: Claim) => claim.at > clock.now - 10 * 60_000 && !notices.some((notice) => notice.alarmId === claim.alarmId && notice.seq > claim.seq);
  const due = () =>
    alarms.filter((alarm) => {
      if (alarm.resolvedAt !== null) return false;
      if (sent(alarm.id).some((notice) => notice.at > clock.now - 24 * HOUR)) return false;
      if (claims.some((claim) => claim.alarmId === alarm.id && holding(claim))) return false;
      if (alarm.subject !== null) return true;
      const sameCondition = (alarmId: string) => alarms.find((other) => other.id === alarmId)?.condition === alarm.condition;
      if (claims.some((claim) => sameCondition(claim.alarmId) && holding(claim))) return false;
      return !notices.some((notice) => notice.outcome === 'sent' && notice.at > clock.now - 24 * HOUR && sameCondition(notice.alarmId));
    });

  const fetch = async (input: string, init?: RequestInit): Promise<Response> => {
    const name = String(input).split('/rpc/')[1];
    const body = JSON.parse(String(init?.body)) as Record<string, any>;
    calls.push(name);
    if (failOnce.delete(name)) return json({message: 'the database is down (fake)'}, 503);
    if (fail[name]) return fail[name]!();
    switch (name) {
      case 'alarm_observations': {
        const o = observed.value;
        return json({...o, tasks: o.tasks});
      }
      case 'raise_alarm': {
        const existing = open(body.p_condition, body.p_subject);
        if (existing) {
          existing.latestAt = clock.now;
          existing.detail = body.p_detail;
          return json({outcome: 'refreshed', alarm_id: existing.id});
        }
        const alarm: Alarm = {id: randomUUID(), condition: body.p_condition, subject: body.p_subject, firstAt: clock.now, latestAt: clock.now, resolvedAt: null, detail: body.p_detail};
        alarms.push(alarm);
        return json({outcome: 'opened', alarm_id: alarm.id});
      }
      case 'resolve_alarm': {
        const existing = open(body.p_condition, body.p_subject);
        if (!existing) return json({outcome: 'none', alarm_id: null});
        existing.resolvedAt = clock.now;
        return json({outcome: 'resolved', alarm_id: existing.id});
      }
      case 'list_alarms': {
        const shown = alarms
          .filter((alarm) => alarm.resolvedAt === null)
          .sort((a, b) => b.firstAt - a.firstAt)
          .concat(body.p_include_resolved ? alarms.filter((alarm) => alarm.resolvedAt !== null).sort((a, b) => b.resolvedAt! - a.resolvedAt!).slice(0, body.p_limit) : []);
        return json({
          alarms: shown.map((alarm) => {
            const mine = notices.filter((notice) => notice.alarmId === alarm.id);
            const lastSent = mine.filter((notice) => notice.outcome === 'sent').at(-1);
            const latest = mine.at(-1);
            return {
              id: alarm.id,
              condition: alarm.condition,
              subject: alarm.subject,
              first_at: iso(alarm.firstAt),
              latest_at: iso(alarm.latestAt),
              resolved_at: alarm.resolvedAt === null ? null : iso(alarm.resolvedAt),
              detail: alarm.detail,
              last_sent_at: lastSent ? iso(lastSent.at) : null,
              last_notice_outcome: latest?.outcome ?? null,
              last_notice_at: latest ? iso(latest.at) : null,
            };
          }),
        });
      }
      case 'alarms_due_mail': {
        // Not read-only: every alarm it returns is claimed, so the next caller does not find it due.
        const handed = due().slice(0, body.p_limit);
        for (const alarm of handed) claims.push({alarmId: alarm.id, at: clock.now, seq: (sequence += 1)});
        return json({alarms: handed.map((alarm) => ({id: alarm.id, condition: alarm.condition, subject: alarm.subject, first_at: iso(alarm.firstAt), detail: alarm.detail}))});
      }
      case 'record_heartbeat': {
        if (revokedKeys.has(body.p_kid)) return json({outcome: 'revoked'});
        if (heartbeats.some((heartbeat) => heartbeat.jti === body.p_jti)) return json({outcome: 'duplicate'});
        heartbeats.push({jti: body.p_jti, kid: body.p_kid});
        return json({outcome: 'recorded'});
      }
      case 'record_alarm_notice':
        // A caller cannot record a claim: only api.alarms_due_mail makes one.
        if (!['sent', 'failed', 'unknown'].includes(body.p_outcome)) return json({code: '22023', message: 'invalid argument'}, 400);
        notices.push({alarmId: body.p_alarm_id, at: clock.now, outcome: body.p_outcome, seq: (sequence += 1)});
        return json({outcome: 'recorded'});
      default:
        throw new Error(`the test did not expect api.${name}`);
    }
  };
  return {
    fetch,
    clock,
    alarms,
    notices,
    claims,
    calls,
    observed,
    heartbeats,
    revokedKeys,
    fail,
    failOnce: (name: string) => failOnce.add(name),
    open,
    openAlarms: () => alarms.filter((alarm) => alarm.resolvedAt === null),
    advance: (ms: number) => {
      clock.now += ms;
    },
  };
}
export type Database = ReturnType<typeof fakeDatabase>;

/** A sender that records what it was given and answers from a script (`sent` once the script is spent). */
export function sender(script: (MailOutcome | 'throw')[] = []) {
  const mails: AlarmNotice[] = [];
  const queue = [...script];
  const send = vi.fn(async (alarm: AlarmNotice): Promise<MailOutcome> => {
    mails.push(alarm);
    const next = queue.shift() ?? {outcome: 'sent' as const};
    if (next === 'throw') throw new Error('the sender broke');
    return next;
  });
  return {send, mails};
}
export const refused: MailOutcome = {outcome: 'refused', reason: 'provider_refused'};
export const unknown: MailOutcome = {outcome: 'unknown', reason: 'timeout'};

