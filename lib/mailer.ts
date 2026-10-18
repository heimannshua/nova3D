// Story 1.6. The one door the application mails through: the Administrator recovery link (`sendRecoveryMail`) and, since Story 1.13, the operational
// alarm (`sendAlarmMail`), each to the configured Administrator address and to nobody else.
//
//   * The recipient is not a parameter. It is ADMINISTRATOR_EMAIL from the server's own environment, read here, so no
//     caller, and no request behind one, can choose where a message goes.
//   * Staging and production send through Resend (POST https://api.resend.com/emails, RESEND_API_KEY) from the
//     resend.dev sender: no domain is owned, so the Resend account must be registered with the Administrator address.
//     `APP_ENV=local` sends to the Supabase stack's Mailpit over HTTP (its /api/v1/send, on the stack's own host, port
//     54324), so the application and the tests share one real path and the Resend transport is covered by unit tests
//     with a faked `fetch` and by the staging attestation.
//   * Plain `fetch`, no SDK (the dependency set is pinned), a timeout, no redirects, and nothing is logged here: not the
//     link, the address, the key, a request or a response. A caller logs the `reason` word, which is a fixed name.
//
// SERVER-ONLY: it reads RESEND_API_KEY. It is not marked with the `server-only` package, like lib/accounts.ts, because that
// would be a new dependency; tests/unit/gate-structure.test.ts pins which files may import it.
import type {AlarmDetail} from '@/lib/alarm-conditions';
import {isEmailAddress, isLoopbackUrl, isPlaceholder, type Env} from '@/lib/environment';

if (typeof window !== 'undefined') {
  throw new Error('lib/mailer.ts is server-only and must not be imported by browser code.');
}

/** How long a send may take before it counts as unanswered. */
export const mailTimeoutMs = 10_000;
/** Where Resend takes a message. */
export const resendEndpoint = 'https://api.resend.com/emails';
/** The sender Resend lets an account without a domain use: it reaches only the address the Resend account is registered with. */
export const resendSender = 'nova3D <onboarding@resend.dev>';
/** The port of the Supabase CLI stack's Mailpit (its default; supabase/config.toml does not move it). */
export const localMailpitPort = 54324;

/**
 * What a send came to.
 *  - `sent`: the provider accepted the message.
 *  - `refused`: the message was NOT sent, definitively (the provider answered with a refusal, or nothing here could be
 *    sent): a token behind it is voided.
 *  - `unknown`: the provider did not answer in time, was not reachable, or failed on its side, so the message may have gone
 *    out anyway.
 * `reason` is one fixed word for the log, never a message or a value.
 */
export type MailOutcome =
  | {outcome: 'sent'}
  | {outcome: 'refused'; reason: 'not_configured' | 'provider_refused'}
  | {outcome: 'unknown'; reason: 'timeout' | 'unreachable' | 'provider_error'};

export type MailerOptions = {
  env?: Env;
  fetch?: (input: string, init?: RequestInit) => Promise<Response>;
  timeoutMs?: number;
};

export const recoverySubject = 'Your nova3D recovery link';

/** A message: a subject, plain text and HTML. */
export type MailMessage = {subject: string; text: string; html: string};

const escapeHtml = (value: string) => value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');

/**
 * The recovery message: a subject, plain text and HTML, each with the link and nothing else that is private. It says who
 * asked for nothing and shows no address, name or Workspace.
 */
export function recoveryMessage(link: string) {
  const text = [
    "Someone asked to recover the Administrator's access to nova3D.",
    '',
    'Open this link to continue. It works once, and it stops working 15 minutes after it was made:',
    '',
    link,
    '',
    'Opening it does not sign anyone in: you confirm on the page it opens. If you did not ask for this, ignore this message and nothing changes. Do not forward it.',
  ].join('\n');
  const safe = escapeHtml(link);
  const html = [
    "<p>Someone asked to recover the Administrator's access to nova3D.</p>",
    `<p>Open this link to continue. It works once, and it stops working 15 minutes after it was made:</p>`,
    `<p><a href="${safe}">${safe}</a></p>`,
    '<p>Opening it does not sign anyone in: you confirm on the page it opens. If you did not ask for this, ignore this message and nothing changes. Do not forward it.</p>',
  ].join('\n');
  return {subject: recoverySubject, text, html};
}

/** The Administrator address the mail goes to, or null when ADMINISTRATOR_EMAIL is missing, a placeholder or not an address. */
function recipientOf(env: Env) {
  const value = env.ADMINISTRATOR_EMAIL?.trim().toLowerCase();
  return value && !isPlaceholder(value) && isEmailAddress(value) ? value : null;
}

/** An address that is not an http(s) link to a real host is not something to put in a mail. */
function isLink(value: string) {
  try {
    const url = new URL(value);
    return (url.protocol === 'https:' || url.protocol === 'http:') && url.hostname !== '' && !url.username && !url.password;
  } catch {
    return false;
  }
}

type Transport = {url: string; headers: Record<string, string>; body: string};

/** The request for this environment, or null when it cannot be made (the environment says which transport, and holds what it needs). */
function transportFor(env: Env, to: string, message: MailMessage): Transport | null {
  if (env.APP_ENV === 'local') {
    // The stack's own Mailpit, on the host the Supabase URL names, which APP_ENV=local requires to be a loopback.
    const base = env.NEXT_PUBLIC_SUPABASE_URL?.trim();
    if (!base || !isLoopbackUrl(base)) return null;
    const host = new URL(base).hostname;
    return {
      url: `http://${host}:${localMailpitPort}/api/v1/send`,
      headers: {'content-type': 'application/json', accept: 'application/json'},
      body: JSON.stringify({From: {Email: 'onboarding@resend.dev', Name: 'nova3D'}, To: [{Email: to}], Subject: message.subject, Text: message.text, HTML: message.html}),
    };
  }
  if (env.APP_ENV === 'staging' || env.APP_ENV === 'production') {
    const key = env.RESEND_API_KEY?.trim();
    if (!key || isPlaceholder(key)) return null;
    return {
      url: resendEndpoint,
      headers: {authorization: `Bearer ${key}`, 'content-type': 'application/json', accept: 'application/json'},
      body: JSON.stringify({from: resendSender, to: [to], subject: message.subject, text: message.text, html: message.html}),
    };
  }
  return null;
}

/**
 * Sends a message to the configured Administrator address and to nobody else (there is no recipient argument: it is read from the environment here).
 * Never throws and never logs. A 2xx is `sent`; any other answer below 500 is `refused` (the message was not sent: a rejected key, an unaccepted
 * recipient, a rate limit); a 5xx, a timeout, a network failure or a redirect is `unknown`.
 */
async function deliver(message: MailMessage, options: MailerOptions): Promise<MailOutcome> {
  const env = options.env ?? process.env;
  const to = recipientOf(env);
  if (!to) return {outcome: 'refused', reason: 'not_configured'};
  const transport = transportFor(env, to, message);
  if (!transport) return {outcome: 'refused', reason: 'not_configured'};
  try {
    new Headers(transport.headers);
  } catch {
    return {outcome: 'refused', reason: 'not_configured'};
  }

  let response: Response;
  try {
    // redirect: 'error' so a key can never follow a redirect to another host.
    response = await (options.fetch ?? fetch)(transport.url, {
      method: 'POST',
      headers: transport.headers,
      body: transport.body,
      redirect: 'error',
      signal: AbortSignal.timeout(options.timeoutMs ?? mailTimeoutMs),
      cache: 'no-store',
    });
  } catch (error) {
    const name = typeof error === 'object' && error !== null ? String((error as {name?: unknown}).name) : '';
    return {outcome: 'unknown', reason: name === 'TimeoutError' || name === 'AbortError' ? 'timeout' : 'unreachable'};
  }
  // The body is never read: it may repeat what was sent. Letting go of it frees the connection.
  try {
    await response.body?.cancel();
  } catch {
    // Nothing to free.
  }
  if (response.ok) return {outcome: 'sent'};
  return response.status >= 500 ? {outcome: 'unknown', reason: 'provider_error'} : {outcome: 'refused', reason: 'provider_refused'};
}

/**
 * Mails the recovery link to the configured Administrator address (and only to it: there is no recipient argument).
 * Never throws and never logs. A 2xx is `sent`; any other answer below 500 is `refused` (the message was not sent: a
 * rejected key, an unaccepted recipient, a rate limit); a 5xx, a timeout, a network failure or a redirect is `unknown`.
 */
export async function sendRecoveryMail(link: string, options: MailerOptions = {}): Promise<MailOutcome> {
  if (!isLink(link)) return {outcome: 'refused', reason: 'not_configured'};
  return deliver(recoveryMessage(link), options);
}

// The operational alarm (Story 1.13) ---------------------------------------------------------------------------------------------------------------

/**
 * What an alarm email holds: the condition, the subject, the first time and the detail. Of the detail the message shows every whole number and boolean with its key,
 * and, of its text, only the three receipt keys below.
 */
export type AlarmNotice = {condition: string; subject: string | null; firstAt: string; detail: AlarmDetail};

/** The keys of an alarm's detail whose TEXT the message may show: the last receipt of the task the alarm is about. No other text of the detail is put in it. */
export const alarmMailDetailKeys = ['receipt_task', 'receipt_outcome', 'receipt_at'] as const;

/** The environments the application runs as (`APP_ENV`); the subject line of an alarm names one, because staging and production mail the same Administrator address. */
const mailEnvironments = ['local', 'staging', 'production'] as const;

/** The environment this application runs as, from `APP_ENV`, or null when it is not one of the three (the message then names none). */
function configuredEnvironment(env: Env): (typeof mailEnvironments)[number] | null {
  // Read exactly as the transport reads it (`env.APP_ENV === 'staging'`): a value that is none of the three has no transport, so there is no message to name it in.
  const value = env.APP_ENV;
  return (mailEnvironments as readonly (string | undefined)[]).includes(value) ? (value as (typeof mailEnvironments)[number]) : null;
}

const alarmDetailKey = /^[a-z][a-z0-9_]{0,31}$/;

const alarmConditionPattern = /^[a-z][a-z0-9-]{0,47}$/;
const alarmSubjectPattern = /^[A-Za-z0-9._:-]{1,64}$/;
const alarmDetailText = /^[ -~]{1,80}$/;
const alarmDetailLabels: Record<(typeof alarmMailDetailKeys)[number], string> = {
  receipt_task: 'Last receipt, task',
  receipt_outcome: 'Last receipt, outcome',
  receipt_at: 'Last receipt, time',
};

/** `2026-10-17T20:41:16.179Z` as `2026-10-17 20:41 UTC`; null for a time that is not one. */
function utcMinute(at: string): string | null {
  const moment = new Date(at);
  return Number.isNaN(moment.getTime()) ? null : `${moment.toISOString().slice(0, 16).replace('T', ' ')} UTC`;
}

/**
 * The alarm message: fixed words, the environment (in the subject line and the first line), the condition, the subject (when there is one), the first time (UTC),
 * every whole number and boolean of the detail with its key, and the three receipt keys of the detail, and nothing else: no other text of the detail, and never an
 * address, a title, a code, a token, a hash or any private content. Null for an alarm that could not be written that way (a condition or subject that is not a
 * plain token, a first time that is not a time). `environment` is the application's `APP_ENV` (null names none).
 */
export function alarmMessage(alarm: AlarmNotice, environment: string | null = null): MailMessage | null {
  if (typeof alarm !== 'object' || alarm === null) return null;
  if (typeof alarm.condition !== 'string' || !alarmConditionPattern.test(alarm.condition)) return null;
  if (alarm.subject !== null && (typeof alarm.subject !== 'string' || !alarmSubjectPattern.test(alarm.subject))) return null;
  const first = typeof alarm.firstAt === 'string' ? utcMinute(alarm.firstAt) : null;
  if (!first) return null;
  const lines: [string, string][] = [];
  if (environment !== null) lines.push(['Environment', environment]);
  lines.push(['Condition', alarm.condition]);
  if (alarm.subject !== null) lines.push(['Subject', alarm.subject]);
  lines.push(['First seen', first]);
  // Every whole number and boolean, by its key (the ages, counts and flags a condition found): they hold no word of anyone's, and the key is a plain lower-case word.
  if (typeof alarm.detail === 'object' && alarm.detail !== null) {
    for (const [key, value] of Object.entries(alarm.detail)) {
      if (alarmDetailKey.test(key) && (typeof value === 'boolean' || (typeof value === 'number' && Number.isSafeInteger(value)))) lines.push([key, String(value)]);
    }
  }
  for (const key of alarmMailDetailKeys) {
    const value = alarm.detail?.[key];
    if (typeof value === 'string' && alarmDetailText.test(value)) lines.push([alarmDetailLabels[key], value]);
  }
  const closing = 'Open Administration, then Operations, in nova3D to see it. While it stays open you are reminded at most once every 24 hours. This message holds no project, file, address or code.';
  const label = environment === null ? '' : `[${environment}] `;
  const subject = alarm.subject === null ? `${label}nova3D alarm: ${alarm.condition}` : `${label}nova3D alarm: ${alarm.condition} (${alarm.subject})`;
  const text = ['nova3D has raised an operational alarm.', '', ...lines.map(([label, value]) => `${label}: ${value}`), '', closing].join('\n');
  const html = [
    '<p>nova3D has raised an operational alarm.</p>',
    `<ul>${lines.map(([label, value]) => `<li>${escapeHtml(label)}: ${escapeHtml(value)}</li>`).join('')}</ul>`,
    `<p>${escapeHtml(closing)}</p>`,
  ].join('\n');
  return {subject, text, html};
}

/**
 * Mails an operational alarm to the configured Administrator address (and only to it: there is no recipient argument), naming the environment it is from. Never
 * throws and never logs.
 * `sent` when the provider accepted it, `refused` when it was definitely not sent (not configured, refused by the provider, an alarm that could not be
 * written), `unknown` when the provider did not answer in time or failed (the message may have gone out, and the caller tries again at the next
 * evaluation: one duplicate is accepted).
 */
export async function sendAlarmMail(alarm: AlarmNotice, options: MailerOptions = {}): Promise<MailOutcome> {
  const message = alarmMessage(alarm, configuredEnvironment(options.env ?? process.env));
  if (!message) return {outcome: 'refused', reason: 'not_configured'};
  return deliver(message, options);
}
