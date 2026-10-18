import {afterEach, describe, expect, it, vi} from 'vitest';
import {alarmMailDetailKeys, alarmMessage, localMailpitPort, mailTimeoutMs, recoveryMessage, recoverySubject, resendEndpoint, resendSender, sendAlarmMail, sendRecoveryMail, type AlarmNotice, type MailerOptions} from '@/lib/mailer';
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

// The operational alarm (Story 1.13): the same door, the same recipient rule and the same transports as the recovery link, a message that holds a condition, a
// subject, a first time and the receipt keys of a detail, and nothing else.
const ALARM: AlarmNotice = {
  condition: 'task-late',
  subject: 'ledger-relay',
  firstAt: '2026-10-17T20:41:16.179Z',
  detail: {receipt_task: 'ledger-relay', receipt_outcome: 'ran', receipt_at: '2026-10-17T20:37:22.998Z', age_seconds: 700, pending: 4, count: 30, note: 'not for the mail'},
};

describe('sendAlarmMail: the transports and the recipient', () => {
  it.each([['staging', staging], ['production', production]] as const)('posts the alarm to Resend in %s, to the configured address only, with the key as a bearer token', async (_name, env) => {
    const {seen, fetch} = recorder(accepted);
    expect(await sendAlarmMail(ALARM, {env, fetch})).toEqual({outcome: 'sent'});
    expect(seen).toHaveLength(1);
    expect(seen[0].url).toBe(resendEndpoint);
    const headers = new Headers(seen[0].init.headers);
    expect(headers.get('authorization')).toBe(`Bearer ${KEY}`);
    const body = JSON.parse(seen[0].init.body as string);
    expect(body.to).toEqual(['administrator@example.test']);
    expect(body.from).toBe(resendSender);
    expect(Object.keys(body).sort()).toEqual(['from', 'html', 'subject', 'text', 'to']);
    expect(body.subject).toBe('nova3D alarm: task-late (ledger-relay)');
  });

  it('posts to Mailpit when the environment is local, to the configured address, and to nothing that is not a loopback', async () => {
    const {seen, fetch} = recorder(accepted);
    expect(await sendAlarmMail(ALARM, {env: local, fetch})).toEqual({outcome: 'sent'});
    expect(seen[0].url).toBe(`http://127.0.0.1:${localMailpitPort}/api/v1/send`);
    const body = JSON.parse(seen[0].init.body as string);
    expect(body.To).toEqual([{Email: 'administrator@example.test'}]);
    expect(Object.keys(body).sort()).toEqual(['From', 'HTML', 'Subject', 'Text', 'To']);
    const refused = recorder(accepted);
    expect(await sendAlarmMail(ALARM, {env: {...local, NEXT_PUBLIC_SUPABASE_URL: 'https://abcdefgh.supabase.co'}, fetch: refused.fetch})).toEqual({outcome: 'refused', reason: 'not_configured'});
    expect(refused.seen).toEqual([]);
  });

  it('has no recipient: it takes an alarm and options, and the address is read from the environment alone', async () => {
    expect(sendAlarmMail.length).toBe(1);
    // A recipient smuggled into the alarm or the options changes nothing about where the mail goes.
    const {seen, fetch} = recorder(accepted);
    await sendAlarmMail({...ALARM, to: 'attacker@example.test', recipient: 'attacker@example.test'} as never, {env: staging, fetch, to: 'attacker@example.test'} as never);
    expect(JSON.parse(seen[0].init.body as string).to).toEqual(['administrator@example.test']);
    expect(seen[0].init.body as string).not.toContain('attacker');
  });

  it('refuses, without sending, when there is no Administrator address, no key, or an environment it has no transport for', async () => {
    for (const env of [{...staging, ADMINISTRATOR_EMAIL: undefined}, {...staging, ADMINISTRATOR_EMAIL: 'not an address'}, {...staging, RESEND_API_KEY: undefined}, {...staging, APP_ENV: 'preview'}, {}] as Env[]) {
      const {seen, fetch} = recorder(accepted);
      expect(await sendAlarmMail(ALARM, {env, fetch})).toEqual({outcome: 'refused', reason: 'not_configured'});
      expect(seen).toEqual([]);
    }
  });

  it('classifies every answer like the recovery mail: 2xx sent, 4xx refused for good, 5xx, a timeout and a network failure unknown', async () => {
    expect(await sendAlarmMail(ALARM, {env: staging, fetch: recorder(() => new Response('bad', {status: 401})).fetch})).toEqual({outcome: 'refused', reason: 'provider_refused'});
    expect(await sendAlarmMail(ALARM, {env: staging, fetch: recorder(() => new Response('bad', {status: 429})).fetch})).toEqual({outcome: 'refused', reason: 'provider_refused'});
    expect(await sendAlarmMail(ALARM, {env: staging, fetch: recorder(() => new Response('bad', {status: 503})).fetch})).toEqual({outcome: 'unknown', reason: 'provider_error'});
    expect(await sendAlarmMail(ALARM, {env: staging, fetch: async () => Promise.reject(Object.assign(new Error('slow'), {name: 'TimeoutError'}))})).toEqual({outcome: 'unknown', reason: 'timeout'});
    expect(await sendAlarmMail(ALARM, {env: staging, fetch: async () => Promise.reject(new TypeError('fetch failed'))})).toEqual({outcome: 'unknown', reason: 'unreachable'});
  });

  it('sets a timeout, refuses a redirect, never caches, and never throws', async () => {
    const {seen, fetch} = recorder(accepted);
    await sendAlarmMail(ALARM, {env: staging, fetch, timeoutMs: 1234});
    expect(seen[0].init.redirect).toBe('error');
    expect(seen[0].init.cache).toBe('no-store');
    expect(seen[0].init.signal).toBeInstanceOf(AbortSignal);
    await expect(sendAlarmMail(ALARM, {env: staging, fetch: () => { throw new RangeError('sync'); }})).resolves.toBeDefined();
    await expect(sendAlarmMail(null as never, {env: staging, fetch})).resolves.toEqual({outcome: 'refused', reason: 'not_configured'});
    await expect(sendAlarmMail(undefined as never)).resolves.toEqual({outcome: 'refused', reason: 'not_configured'});
  });
});

describe('the alarm message', () => {
  const message = alarmMessage(ALARM)!;

  it('says what it is, in fixed words, with the condition, the subject, the first time in UTC and the receipt keys of the detail', () => {
    expect(message.subject).toBe('nova3D alarm: task-late (ledger-relay)');
    expect(message.text).toBe(
      [
        'nova3D has raised an operational alarm.',
        '',
        'Condition: task-late',
        'Subject: ledger-relay',
        'First seen: 2026-10-17 20:41 UTC',
        'Last receipt, task: ledger-relay',
        'Last receipt, outcome: ran',
        'Last receipt, time: 2026-10-17T20:37:22.998Z',
        '',
        'Open Administration, then Operations, in nova3D to see it. While it stays open you are reminded at most once every 24 hours. This message holds no project, file, address or code.',
      ].join('\n'),
    );
    expect(message.html).toContain('<li>Condition: task-late</li>');
    expect(message.html).toContain('<li>First seen: 2026-10-17 20:41 UTC</li>');
    expect([...alarmMailDetailKeys]).toEqual(['receipt_task', 'receipt_outcome', 'receipt_at']);
  });

  it('puts in the detail\'s receipt keys and no other key: not a count, an age, a note, or anything a later condition adds', () => {
    for (const part of [message.text, message.html]) {
      expect(part).not.toMatch(/700|\bcount\b|not for the mail|age_seconds|pending/);
    }
    const bare = alarmMessage({condition: 'identities-unaccounted', subject: null, firstAt: ALARM.firstAt, detail: {count: 30}})!;
    expect(bare.subject).toBe('nova3D alarm: identities-unaccounted');
    expect(bare.text).toBe(['nova3D has raised an operational alarm.', '', 'Condition: identities-unaccounted', 'First seen: 2026-10-17 20:41 UTC', '', message.text.split('\n').at(-1)].join('\n'));
    expect(bare.text).not.toContain('Subject:');
  });

  it('shows no address, no title, no code, no token and no link', () => {
    for (const part of [message.text, message.html]) {
      expect(part).not.toMatch(/@|https?:|workspace|project name|token|code:|title/i);
    }
  });

  it('writes a receipt value only when it is plain printable text, and escapes whatever it writes', () => {
    const odd = alarmMessage({...ALARM, detail: {receipt_task: '<script>x</script>', receipt_outcome: 'a & b', receipt_at: 'caf\u00e9', age_seconds: 5}})!;
    expect(odd.html).toContain('&lt;script&gt;x&lt;/script&gt;');
    expect(odd.html).toContain('a &amp; b');
    expect(odd.html).not.toContain('<script>');
    // A value that is not printable ASCII, a number where text belongs, and a value of 81 characters are left out.
    expect(odd.text).not.toContain('Last receipt, time');
    const left = alarmMessage({...ALARM, detail: {receipt_task: 5 as never, receipt_outcome: 'x'.repeat(81), receipt_at: ''}})!;
    expect(left.text).not.toContain('Last receipt');
  });

  it('is not written for an alarm that could not be written that way: a condition or subject that is not a plain token, a first time that is not a time', () => {
    for (const change of [{condition: 'Task Late'}, {condition: ''}, {condition: 'a\nb'}, {subject: 'a b'}, {subject: 'x\r\nBcc: attacker@example.test'}, {subject: ''}, {firstAt: 'yesterday'}, {firstAt: undefined}]) {
      expect(alarmMessage({...ALARM, ...change} as never), JSON.stringify(change)).toBeNull();
    }
  });

  it('cannot be turned into a second header or a second recipient: the subject line holds only a condition and a subject, which are plain tokens', () => {
    expect(message.subject).not.toMatch(/[\r\n<>"]/);
  });
});

describe('what the alarm mail prints', () => {
  it('nothing, on any outcome: not the condition, the address, the key or a response', async () => {
    const spies = (['log', 'info', 'warn', 'error', 'debug'] as const).map((name) => vi.spyOn(console, name).mockImplementation(() => undefined));
    const answers: (() => Response | Promise<Response>)[] = [accepted, () => new Response('{"message":"bad key"}', {status: 401}), () => new Response('{}', {status: 503}), () => Promise.reject(new TypeError('fetch failed'))];
    for (const env of [staging, local]) for (const answer of answers) await sendAlarmMail(ALARM, {env, fetch: recorder(answer).fetch});
    await sendAlarmMail({...ALARM, condition: 'Bad'}, {env: staging, fetch: recorder(accepted).fetch});
    for (const spy of spies) expect(spy).not.toHaveBeenCalled();
  });

  it('returns no more than a fixed word: the outcome carries no message, address, key or body', async () => {
    const results = [
      await sendAlarmMail(ALARM, {env: staging, fetch: recorder(() => new Response(`{"message":"${KEY} ${ADMIN}"}`, {status: 422})).fetch}),
      await sendAlarmMail(ALARM, {env: staging, fetch: async () => Promise.reject(new TypeError(`${KEY} ${ADMIN}`))}),
    ];
    const text = JSON.stringify(results);
    expect(text).not.toContain(KEY);
    expect(text).not.toContain(ADMIN);
  });
});
