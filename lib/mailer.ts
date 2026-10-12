// Story 1.6. The one door the application mails through: the Administrator recovery link, to the configured
// Administrator address and to nobody else. (Story 1.13's alarm mail will go through here too.)
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
function transportFor(env: Env, to: string, message: ReturnType<typeof recoveryMessage>): Transport | null {
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
 * Mails the recovery link to the configured Administrator address (and only to it: there is no recipient argument).
 * Never throws and never logs. A 2xx is `sent`; any other answer below 500 is `refused` (the message was not sent: a
 * rejected key, an unaccepted recipient, a rate limit); a 5xx, a timeout, a network failure or a redirect is `unknown`.
 */
export async function sendRecoveryMail(link: string, options: MailerOptions = {}): Promise<MailOutcome> {
  const env = options.env ?? process.env;
  const to = recipientOf(env);
  if (!to || !isLink(link)) return {outcome: 'refused', reason: 'not_configured'};
  const transport = transportFor(env, to, recoveryMessage(link));
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
