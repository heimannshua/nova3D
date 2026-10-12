import {afterEach, describe, expect, it, vi} from 'vitest';
import {localMailpitPort, mailTimeoutMs, recoveryMessage, recoverySubject, resendEndpoint, resendSender, sendRecoveryMail, type MailerOptions} from '@/lib/mailer';
import type {Env} from '@/lib/environment';

// The mailer (Story 1.6) on both transports with a faked `fetch`: where it sends, to whom, what the link and the key look like
// on the wire, how every answer is classified (sent, refused for good, outcome unknown), and that nothing is ever logged. No test
// makes a real call.
const ADMIN = 'Administrator@Example.Test';
const KEY = 'resend-key-must-never-be-printed-or-returned';
const TOKEN = 'a'.repeat(43);
const LINK = `https://nova3d-staging.example.test/recover/confirm#${TOKEN}`;

const staging: Env = {APP_ENV: 'staging', ADMINISTRATOR_EMAIL: ADMIN, RESEND_API_KEY: KEY, NEXT_PUBLIC_SUPABASE_URL: 'https://abcdefgh.supabase.co'};
const production: Env = {...staging, APP_ENV: 'production'};
const local: Env = {APP_ENV: 'local', ADMINISTRATOR_EMAIL: ADMIN, NEXT_PUBLIC_SUPABASE_URL: 'http://127.0.0.1:54321'};

type Seen = {url: string; init: RequestInit};
function recorder(answer: () => Response | Promise<Response>) {
  const seen: Seen[] = [];
  const fetch: NonNullable<MailerOptions['fetch']> = async (url, init) => {
    seen.push({url, init: init ?? {}});
    return answer();
  };
  return {seen, fetch};
}
const accepted = () => new Response('{"id":"message-id"}', {status: 200});

afterEach(() => vi.restoreAllMocks());

describe('Resend (staging and production)', () => {
  it.each([['staging', staging], ['production', production]] as const)('posts the message to Resend in %s, to the configured address only, with the key as a bearer token', async (_name, env) => {
    const {seen, fetch} = recorder(accepted);
    expect(await sendRecoveryMail(LINK, {env, fetch})).toEqual({outcome: 'sent'});
    expect(seen).toHaveLength(1);
    expect(seen[0].url).toBe(resendEndpoint);
    expect(resendEndpoint).toBe('https://api.resend.com/emails');
    const init = seen[0].init;
    expect(init.method).toBe('POST');
    const headers = new Headers(init.headers);
    expect(headers.get('authorization')).toBe(`Bearer ${KEY}`);
    expect(headers.get('content-type')).toBe('application/json');
    const body = JSON.parse(init.body as string);
    // Only the configured address (lower case), from the resend.dev sender; no cc, bcc or reply-to.
    expect(body.to).toEqual(['administrator@example.test']);
    expect(body.from).toBe(resendSender);
    expect(resendSender).toMatch(/@resend\.dev>$/);
    expect(Object.keys(body).sort()).toEqual(['from', 'html', 'subject', 'text', 'to']);
    expect(body.subject).toBe(recoverySubject);
  });

  it('puts the link in the text and in the HTML, and the token nowhere else', async () => {
    const {seen, fetch} = recorder(accepted);
    await sendRecoveryMail(LINK, {env: staging, fetch});
    const body = JSON.parse(seen[0].init.body as string);
    expect(body.text).toContain(LINK);
    expect(body.html).toContain(`href="${LINK}"`);
    // The token is only in the fragment of the link, never as a word of its own or in the subject.
    expect(body.subject).not.toContain(TOKEN);
    expect(body.text.split(TOKEN)).toHaveLength(2);
    expect(body.html.split(TOKEN)).toHaveLength(3);
    expect(seen[0].url).not.toContain(TOKEN);
  });

  it('does not take the recipient from anywhere but the environment: there is no argument for it, and a link that names another address does not move it', async () => {
    expect(sendRecoveryMail.length).toBeLessThanOrEqual(2);
    const {seen, fetch} = recorder(accepted);
    await sendRecoveryMail('https://nova3d-staging.example.test/recover/confirm?to=someone-else@example.test#x', {env: staging, fetch});
    expect(JSON.parse(seen[0].init.body as string).to).toEqual(['administrator@example.test']);
  });

  it('refuses a request with a redirect that could carry the key to another host, a bounded wait and no cache', async () => {
    const {seen, fetch} = recorder(accepted);
    await sendRecoveryMail(LINK, {env: staging, fetch});
    expect(seen[0].init.redirect).toBe('error');
    expect(seen[0].init.cache).toBe('no-store');
    expect(seen[0].init.signal).toBeInstanceOf(AbortSignal);
    expect(mailTimeoutMs).toBe(10_000);
  });

  it('is sent on any 2xx', async () => {
    for (const status of [200, 201, 202]) {
      const {fetch} = recorder(() => new Response('{}', {status}));
      expect(await sendRecoveryMail(LINK, {env: staging, fetch}), String(status)).toEqual({outcome: 'sent'});
    }
  });

  it.each([400, 401, 403, 404, 409, 422, 429])('is refused for good on HTTP %i: the provider said no, so the message was not sent', async (status) => {
    const {fetch} = recorder(() => new Response('{"message":"no"}', {status}));
    expect(await sendRecoveryMail(LINK, {env: staging, fetch})).toEqual({outcome: 'refused', reason: 'provider_refused'});
  });

  it.each([500, 502, 503, 504])('is unknown on HTTP %i: the provider failed, so the message may have gone out', async (status) => {
    const {fetch} = recorder(() => new Response('{}', {status}));
    expect(await sendRecoveryMail(LINK, {env: staging, fetch})).toEqual({outcome: 'unknown', reason: 'provider_error'});
  });

  it('is unknown on a timeout, a dropped connection and a redirect', async () => {
    const timeout = async () => {
      throw Object.assign(new Error('timed out'), {name: 'TimeoutError'});
    };
    const abort = async () => {
      throw Object.assign(new Error('aborted'), {name: 'AbortError'});
    };
    const dropped = async () => {
      throw new TypeError('fetch failed');
    };
    const redirected = async () => {
      throw new TypeError('fetch failed', {cause: new Error('unexpected redirect')});
    };
    expect(await sendRecoveryMail(LINK, {env: staging, fetch: timeout})).toEqual({outcome: 'unknown', reason: 'timeout'});
    expect(await sendRecoveryMail(LINK, {env: staging, fetch: abort})).toEqual({outcome: 'unknown', reason: 'timeout'});
    expect(await sendRecoveryMail(LINK, {env: staging, fetch: dropped})).toEqual({outcome: 'unknown', reason: 'unreachable'});
    expect(await sendRecoveryMail(LINK, {env: staging, fetch: redirected})).toEqual({outcome: 'unknown', reason: 'unreachable'});
  });

  it('really times out: a provider that never answers is unknown after the bounded wait', async () => {
    const hangs: NonNullable<MailerOptions['fetch']> = (_url, init) =>
      new Promise((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => reject(Object.assign(new Error('timed out'), {name: 'TimeoutError'})));
      });
    expect(await sendRecoveryMail(LINK, {env: staging, fetch: hangs, timeoutMs: 20})).toEqual({outcome: 'unknown', reason: 'timeout'});
  });

  it.each([
    ['no key', {...staging, RESEND_API_KEY: undefined}],
    ['an empty key', {...staging, RESEND_API_KEY: '  '}],
    ['a placeholder key', {...staging, RESEND_API_KEY: '<staging-resend-api-key>'}],
    ['no Administrator address', {...staging, ADMINISTRATOR_EMAIL: undefined}],
    ['a placeholder address', {...staging, ADMINISTRATOR_EMAIL: '<administrator-email>'}],
    ['an address that is not one', {...staging, ADMINISTRATOR_EMAIL: 'not-an-address'}],
    ['several addresses', {...staging, ADMINISTRATOR_EMAIL: 'a@example.test, b@example.test'}],
    ['a key that cannot be a header', {...staging, RESEND_API_KEY: 'line\nbreak'}],
    ['an unknown environment', {...staging, APP_ENV: 'qa'}],
  ] as [string, Env][])('is refused, without a request, with %s', async (_name, env) => {
    const {seen, fetch} = recorder(accepted);
    expect(await sendRecoveryMail(LINK, {env, fetch})).toEqual({outcome: 'refused', reason: 'not_configured'});
    expect(seen).toEqual([]);
  });

  it.each(['', 'not a link', 'javascript:alert(1)', 'ftp://example.test/recover/confirm#x', 'https://user:pass@example.test/recover/confirm#x', 'https://'])('is refused, without a request, for the link %j', async (link) => {
    const {seen, fetch} = recorder(accepted);
    expect(await sendRecoveryMail(link, {env: staging, fetch})).toEqual({outcome: 'refused', reason: 'not_configured'});
    expect(seen).toEqual([]);
  });
});

describe('Mailpit (APP_ENV=local)', () => {
  it('posts the message to the stack\'s Mailpit over plain HTTP, on the host the Supabase URL names, with no key', async () => {
    const {seen, fetch} = recorder(accepted);
    expect(await sendRecoveryMail('http://127.0.0.1:4173/recover/confirm#' + TOKEN, {env: local, fetch})).toEqual({outcome: 'sent'});
    expect(seen).toHaveLength(1);
    expect(seen[0].url).toBe(`http://127.0.0.1:${localMailpitPort}/api/v1/send`);
    expect(localMailpitPort).toBe(54324);
    const headers = new Headers(seen[0].init.headers);
    expect(headers.get('authorization')).toBeNull();
    const body = JSON.parse(seen[0].init.body as string);
    expect(body.To).toEqual([{Email: 'administrator@example.test'}]);
    expect(body.From.Email).toBe('onboarding@resend.dev');
    expect(body.Subject).toBe(recoverySubject);
    expect(body.Text).toContain(`http://127.0.0.1:4173/recover/confirm#${TOKEN}`);
    expect(body.HTML).toContain(`href="http://127.0.0.1:4173/recover/confirm#${TOKEN}"`);
    expect(seen[0].init.redirect).toBe('error');
  });

  it('follows the Supabase URL\'s own loopback host, and nothing else', async () => {
    for (const [url, host] of [['http://localhost:54321', 'localhost'], ['http://[::1]:54321', '[::1]'], ['http://127.0.0.1:54321', '127.0.0.1']] as const) {
      const {seen, fetch} = recorder(accepted);
      await sendRecoveryMail('http://127.0.0.1:4173/recover/confirm#x', {env: {...local, NEXT_PUBLIC_SUPABASE_URL: url}, fetch});
      expect(seen[0].url, url).toBe(`http://${host}:54324/api/v1/send`);
    }
  });

  it('never sends to a host that is not a loopback, however the environment says it is local', async () => {
    const {seen, fetch} = recorder(accepted);
    for (const url of ['https://abcdefgh.supabase.co', 'http://127.0.0.1.nip.io:54321', undefined]) {
      expect(await sendRecoveryMail(LINK, {env: {...local, NEXT_PUBLIC_SUPABASE_URL: url}, fetch}), String(url)).toEqual({outcome: 'refused', reason: 'not_configured'});
    }
    expect(seen).toEqual([]);
  });

  it('classifies Mailpit\'s answers like any provider\'s', async () => {
    expect(await sendRecoveryMail(LINK, {env: local, fetch: recorder(() => new Response('bad', {status: 400})).fetch})).toEqual({outcome: 'refused', reason: 'provider_refused'});
    expect(await sendRecoveryMail(LINK, {env: local, fetch: recorder(() => new Response('bad', {status: 500})).fetch})).toEqual({outcome: 'unknown', reason: 'provider_error'});
    const refused = async () => {
      throw new TypeError('fetch failed');
    };
    expect(await sendRecoveryMail(LINK, {env: local, fetch: refused})).toEqual({outcome: 'unknown', reason: 'unreachable'});
  });
});

describe('the message', () => {
  const message = recoveryMessage(LINK);

  it('says what it is, once, with the link, and shows no address, name, Workspace or project', () => {
    expect(message.subject).toBe('Your nova3D recovery link');
    expect(message.text).toContain(LINK);
    expect(message.text).toContain('15 minutes');
    expect(message.text).toMatch(/works once/);
    for (const part of [message.text, message.html]) {
      expect(part).not.toMatch(/@/);
      expect(part).not.toMatch(/workspace|project/i);
    }
  });

  it('escapes the link in the HTML, so a link cannot break out of its attribute', () => {
    const html = recoveryMessage('https://example.test/recover/confirm#a"onmouseover="x').html;
    expect(html).not.toContain('"onmouseover="x');
    expect(html).toContain('&quot;onmouseover=&quot;x');
  });
});

describe('what it prints', () => {
  it('nothing, on any outcome: not the link, the address, the key or a response', async () => {
    const spies = (['log', 'info', 'warn', 'error', 'debug'] as const).map((name) => vi.spyOn(console, name).mockImplementation(() => undefined));
    const answers: (() => Response | Promise<Response>)[] = [accepted, () => new Response('{"message":"bad key"}', {status: 401}), () => new Response('{}', {status: 503}), () => Promise.reject(new TypeError('fetch failed'))];
    for (const env of [staging, local]) for (const answer of answers) await sendRecoveryMail(LINK, {env, fetch: recorder(answer).fetch});
    await sendRecoveryMail('not a link', {env: staging, fetch: recorder(accepted).fetch});
    for (const spy of spies) expect(spy).not.toHaveBeenCalled();
  });

  it('never returns more than a fixed word: the outcome carries no message, address, key or body', async () => {
    const results = [
      await sendRecoveryMail(LINK, {env: staging, fetch: recorder(() => new Response(`{"message":"${KEY} ${ADMIN} ${LINK}"}`, {status: 422})).fetch}),
      await sendRecoveryMail(LINK, {env: staging, fetch: async () => Promise.reject(new TypeError(`${KEY} ${ADMIN}`))}),
    ];
    const text = JSON.stringify(results);
    expect(text).not.toContain(KEY);
    expect(text).not.toContain(ADMIN);
    expect(text).not.toContain(TOKEN);
  });
});
