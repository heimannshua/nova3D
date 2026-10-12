import {localStack} from './stack';

// Story 1.6. The Supabase CLI stack's Mailpit, over its HTTP API: where the application's recovery mail goes when
// APP_ENV=local (lib/mailer.ts), so the browser tests read the very message the application sent. The port is the stack's
// default (supabase/config.toml does not move it), on the host the stack's API URL names. Nothing here sends mail: the test
// that needs a real Resend call does not exist, because no test makes one.

export type MailSummary = {id: string; to: string[]; from: string; subject: string; created: string};
export type Mail = MailSummary & {text: string; html: string};

const mailpitPort = 54324;
const base = () => `http://${new URL(localStack().apiUrl).hostname}:${mailpitPort}/api/v1`;

async function call(path: string, init?: RequestInit) {
  const response = await fetch(`${base()}${path}`, {...init, signal: AbortSignal.timeout(10_000)});
  if (!response.ok) throw new Error(`Mailpit answered HTTP ${response.status} for ${init?.method ?? 'GET'} ${path}. Is the Supabase stack running with Mailpit (not excluded by -x)?`);
  return response;
}

/** Deletes every message in the mailbox. The recovery flows are one serial spec, so nothing else is reading it. */
export async function clearMailbox() {
  await call('/messages', {method: 'DELETE', headers: {'content-type': 'application/json'}, body: '{}'});
}

/** Every message in the mailbox (newest first), as a summary. */
export async function listMail(): Promise<MailSummary[]> {
  const body = (await (await call('/messages?limit=200')).json()) as {messages: {ID: string; To: {Address: string}[]; From: {Address: string}; Subject: string; Created: string}[]};
  return body.messages.map((message) => ({id: message.ID, to: message.To.map((to) => to.Address), from: message.From.Address, subject: message.Subject, created: message.Created}));
}

/** One message in full. */
export async function readMail(id: string): Promise<Mail> {
  const message = (await (await call(`/message/${id}`)).json()) as {ID: string; To: {Address: string}[]; From: {Address: string}; Subject: string; Created: string; Text: string; HTML: string};
  return {id: message.ID, to: message.To.map((to) => to.Address), from: message.From.Address, subject: message.Subject, created: message.Created, text: message.Text, html: message.HTML};
}

/** Waits for at least `count` messages, then returns all of them in full (oldest first). Fails with what it saw after `timeoutMs`. */
export async function waitForMail(count = 1, timeoutMs = 10_000): Promise<Mail[]> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const summaries = await listMail();
    if (summaries.length >= count) return Promise.all([...summaries].reverse().map((summary) => readMail(summary.id)));
    if (Date.now() > deadline) throw new Error(`Expected ${count} message(s) in Mailpit but found ${summaries.length} after ${timeoutMs} ms.`);
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
}

/** The recovery link in a message's text: the one URL that ends in `/recover/confirm#<token>`. */
export function recoveryLinkIn(text: string): string {
  const match = /https?:\/\/[^\s"'<>]+\/recover\/confirm#[A-Za-z0-9_-]+/.exec(text);
  if (!match) throw new Error('The message holds no recovery link.');
  return match[0];
}

/** The token after the `#` of a recovery link. */
export const tokenOfLink = (link: string) => link.slice(link.indexOf('#') + 1);
