import {createHmac, randomBytes} from 'node:crypto';
import {readdirSync, readFileSync, statSync} from 'node:fs';
import {dirname, join, relative, resolve} from 'node:path';
import {afterEach, describe, expect, it, vi} from 'vitest';
import {
  AccountsConfigError,
  AccountsUnavailableError,
  accountStatus,
  adoptPreferences,
  authorizeSession,
  canonicalizeInvitationCode,
  clientAddressFromHeaders,
  confirmRegistration,
  accountRefusalActions,
  consumePreauthorization,
  disableAccount,
  enableAccount,
  generateInvitationCode,
  hashClientAddress,
  hashInvitationCode,
  hashKey,
  invitationCodeBytes,
  invitationCodeEntropyBits,
  issueCsrf,
  issueGrant,
  issueInvitation,
  listInvitations,
  invitationRefusalActions,
  guardOperation,
  hashRecoveryToken,
  isRecoveryToken,
  issueRecovery,
  checkRecovery,
  newRecoveryToken,
  redeemRecoveryToken,
  recoveryRefusals,
  voidRecovery,
  listAccounts,
  looksLikeInvitationCode,
  normalizeClientAddress,
  operationOutcomes,
  recordAccountRefusal,
  recordInvitationRefusal,
  raiseAuthorizationEpoch,
  registerWithCode,
  revokeAccountGrants,
  revokeGrantsBelowEpoch,
  revokeInvitation,
  revokeSessionGrant,
  seedPreauthorization,
  setAccountPreference,
  verifyCsrf,
  withdrawPreauthorization,
} from '@/lib/accounts';
import type {Env} from '@/lib/environment';

const root = resolve(import.meta.dirname, '../..');
const alphabet = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
const key = () => randomBytes(32);
const keyText = () => randomBytes(32).toString('base64');

/** Inverse of the encoder, written independently so a round trip proves the code carries every byte. */
function decodeCode(code: string) {
  let bits = 0;
  let buffer = 0;
  const bytes: number[] = [];
  for (const char of code.replaceAll('-', '')) {
    buffer = (buffer << 5) | alphabet.indexOf(char);
    bits += 5;
    if (bits >= 8) {
      bytes.push((buffer >>> (bits - 8)) & 255);
      bits -= 8;
      buffer &= (1 << bits) - 1;
    }
  }
  return Buffer.from(bytes);
}

describe('invitation codes', () => {
  it('carry at least 128 bits, and this module issues 160', () => {
    expect(invitationCodeBytes * 8).toBe(invitationCodeEntropyBits);
    expect(invitationCodeEntropyBits).toBeGreaterThanOrEqual(128);
    const sizes: number[] = [];
    generateInvitationCode((size) => {
      sizes.push(size);
      return randomBytes(size);
    });
    expect(sizes).toEqual([20]);
  });

  it('are eight groups of four Crockford base32 characters', () => {
    expect(generateInvitationCode()).toMatch(/^(?:[0-9A-HJKMNP-TV-Z]{4}-){7}[0-9A-HJKMNP-TV-Z]{4}$/);
  });

  it('encode every random byte, so no entropy is lost', () => {
    for (const bytes of [Buffer.alloc(20, 0), Buffer.alloc(20, 255), randomBytes(20), randomBytes(20)]) {
      expect(decodeCode(generateInvitationCode(() => bytes)).equals(bytes)).toBe(true);
    }
    expect(generateInvitationCode(() => Buffer.alloc(20, 0))).toBe('0000-0000-0000-0000-0000-0000-0000-0000');
    expect(generateInvitationCode(() => Buffer.alloc(20, 255))).toBe('ZZZZ-ZZZZ-ZZZZ-ZZZZ-ZZZZ-ZZZZ-ZZZZ-ZZZZ');
  });

  it('come from a CSPRNG by default and never repeat', () => {
    const seen = new Set(Array.from({length: 2000}, () => generateInvitationCode()));
    expect(seen.size).toBe(2000);
    expect(readFileSync(join(root, 'lib/accounts.ts'), 'utf8')).not.toMatch(/Math\.random/);
  });

  it('refuse a random source that returns the wrong number of bytes', () => {
    expect(() => generateInvitationCode(() => randomBytes(8))).toThrow('wrong number of bytes');
  });

  it('are canonicalized before hashing: case, whitespace, every hyphen or dash and look-alike characters do not matter', () => {
    const code = generateInvitationCode();
    const variants = [
      code.toLowerCase(),
      code.replaceAll('-', ''),
      code.replaceAll('-', ' '),
      code.replaceAll('-', '\t'),
      `  ${code}\n`,
      code.replaceAll('0', 'o').replaceAll('1', 'l'),
      // Typographic hyphens and dashes: U+2010 to U+2015 (U+2011 is the non-breaking hyphen), U+2212 (minus),
      // and the full-width hyphen-minus, which NFKC folds to ASCII.
      ...['‐', '‑', '‒', '–', '—', '―', '−', '－'].map((dash) => code.replaceAll('-', dash)),
      code.replaceAll('-', ' '),
      code.replaceAll('-', ' '),
    ];
    for (const variant of variants) expect(canonicalizeInvitationCode(variant), JSON.stringify(variant)).toBe(canonicalizeInvitationCode(code));
    expect(canonicalizeInvitationCode('Il-Oo')).toBe('1100');
    for (const variant of variants) expect(looksLikeInvitationCode(variant), JSON.stringify(variant)).toBe(true);
    expect(looksLikeInvitationCode('not a code')).toBe(false);
    expect(looksLikeInvitationCode(code.slice(0, -1))).toBe(false);
    expect(looksLikeInvitationCode(`${code}A`)).toBe(false);
  });

  it('treat anything that is not a string as an empty code', () => {
    for (const value of [undefined, null, 42, {}, [], ['A'], true, Symbol('x')]) {
      expect(canonicalizeInvitationCode(value), String(typeof value)).toBe('');
      expect(looksLikeInvitationCode(value)).toBe(false);
    }
  });

  it('bound the input before it is normalized, so a huge input costs a bounded amount and cannot hide a code in its tail', () => {
    const code = generateInvitationCode();
    expect(canonicalizeInvitationCode('A'.repeat(10_000_000)).length).toBeLessThanOrEqual(128);
    // Whitespace past the bound is cut off before it is stripped: a code behind 600 spaces is not seen.
    expect(canonicalizeInvitationCode(' '.repeat(600) + code)).toBe('');
    expect(canonicalizeInvitationCode(' '.repeat(100) + code)).toBe(canonicalizeInvitationCode(code));
    expect(hashInvitationCode('\u0000\ud800', key())).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe('hashing', () => {
  it('stores HMAC-SHA256 of the canonical code under the key, with a domain label', () => {
    const k = key();
    const code = generateInvitationCode();
    const expected = createHmac('sha256', k).update(`nova3d/invitation-code/v1\u0000${canonicalizeInvitationCode(code)}`).digest('hex');
    expect(hashInvitationCode(code, k)).toBe(expected);
    expect(hashInvitationCode(code.toLowerCase().replaceAll('-', ' '), k)).toBe(expected);
  });

  it('depends on the key and on the code, and is never the code', () => {
    const code = generateInvitationCode();
    expect(hashInvitationCode(code, key())).not.toBe(hashInvitationCode(code, key()));
    expect(hashInvitationCode(generateInvitationCode(), key())).toMatch(/^[0-9a-f]{64}$/);
    const k = key();
    expect(hashInvitationCode(code, k)).not.toBe(hashInvitationCode(generateInvitationCode(), k));
    expect(hashInvitationCode(code, k)).not.toContain(canonicalizeInvitationCode(code).toLowerCase());
  });

  it('separates the two uses of a key by domain', () => {
    const k = key();
    expect(hashInvitationCode('203.0.113.9', k)).not.toBe(hashClientAddress('203.0.113.9', k));
  });
});

describe('client addresses', () => {
  it('keep IPv4 whole', () => {
    expect(normalizeClientAddress('203.0.113.9')).toBe('203.0.113.9');
    expect(normalizeClientAddress(' 203.0.113.9 ')).toBe('203.0.113.9');
    expect(normalizeClientAddress('203.0.113.9')).not.toBe(normalizeClientAddress('203.0.113.10'));
  });

  it('reduce IPv6 to its /64 network and fold IPv4-mapped addresses into IPv4', () => {
    const network = normalizeClientAddress('2001:db8:1:2:aaaa:bbbb:cccc:dddd');
    expect(network).toBe('2001:db8:1:2::/64');
    expect(normalizeClientAddress('2001:DB8:1:2::1')).toBe(network);
    expect(normalizeClientAddress('[2001:db8:1:2::1]')).toBe(network);
    expect(normalizeClientAddress('2001:db8:1:2::1%eth0')).toBe(network);
    expect(normalizeClientAddress('2001:db8:1:3::1')).not.toBe(network);
    expect(normalizeClientAddress('::ffff:203.0.113.9')).toBe('203.0.113.9');
    expect(normalizeClientAddress('::ffff:cb00:7109')).toBe('203.0.113.9');
    expect(normalizeClientAddress('::1')).toBe('0:0:0:0::/64');
    expect(normalizeClientAddress('::')).toBe('0:0:0:0::/64');
    expect(normalizeClientAddress('2001:db8::')).toBe('2001:db8:0:0::/64');
  });

  it('send anything missing or invalid to one shared origin, so it cannot escape the limit', () => {
    const invalid = [
      null, undefined, '', '   ', 'garbage', '999.1.1.1', '1.2.3', '1:2:3', '1::2::3', ':::', 'g::1', '1.2.3.4.5',
      // Not valid to node:net: leading zeros, a port, a bracketed address with a port, an over-long value.
      '01.2.3.4', '203.0.113.9:51234', '[2001:db8:1:2::1]:443', 'a'.repeat(65), `::${'0'.repeat(70)}1`,
    ];
    for (const value of invalid) expect(normalizeClientAddress(value), String(value)).toBe('unknown');
    const k = key();
    expect(hashClientAddress(null, k)).toBe(hashClientAddress('garbage', k));
  });

  it('hash to HMAC-SHA256 under the key and never contain the address', () => {
    const k = key();
    const hash = hashClientAddress('203.0.113.9', k);
    expect(hash).toBe(createHmac('sha256', k).update('nova3d/client-address/v1\u0000203.0.113.9').digest('hex'));
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
    expect(hash).not.toContain('203');
    expect(hashClientAddress('203.0.113.9', key())).not.toBe(hash);
    expect(hashClientAddress('203.0.113.10', k)).not.toBe(hash);
  });

  describe('from the platform headers', () => {
    const headers = (values: Record<string, string>) => ({get: (name: string) => values[name] ?? null});
    const vercel: Env = {VERCEL: '1'};

    it('are believed only on Vercel; anywhere else every request shares the unknown origin', () => {
      const spoofed = headers({'x-forwarded-for': '198.51.100.7', 'x-real-ip': '198.51.100.8', 'x-vercel-forwarded-for': '198.51.100.9'});
      expect(clientAddressFromHeaders(spoofed, {})).toBeNull();
      expect(clientAddressFromHeaders(spoofed, {VERCEL: ''})).toBeNull();
      expect(clientAddressFromHeaders(spoofed, {NODE_ENV: 'production'})).toBeNull();
      expect(clientAddressFromHeaders(spoofed, vercel)).toBe('198.51.100.9');
    });

    it('default to the process environment', () => {
      vi.stubEnv('VERCEL', '');
      expect(clientAddressFromHeaders(headers({'x-forwarded-for': '198.51.100.7'}))).toBeNull();
      vi.stubEnv('VERCEL', '1');
      expect(clientAddressFromHeaders(headers({'x-forwarded-for': '198.51.100.7'}))).toBe('198.51.100.7');
      vi.unstubAllEnvs();
    });

    it('take the first entry of the first usable header, in order of trust', () => {
      expect(clientAddressFromHeaders(headers({}), vercel)).toBeNull();
      expect(clientAddressFromHeaders(headers({'x-forwarded-for': '198.51.100.7, 10.0.0.1'}), vercel)).toBe('198.51.100.7');
      expect(clientAddressFromHeaders(headers({'x-real-ip': '198.51.100.8', 'x-forwarded-for': '198.51.100.7'}), vercel)).toBe('198.51.100.8');
      expect(clientAddressFromHeaders(headers({'x-vercel-forwarded-for': '198.51.100.9', 'x-real-ip': '198.51.100.8'}), vercel)).toBe('198.51.100.9');
      expect(clientAddressFromHeaders(headers({'x-forwarded-for': '2001:db8:1:2::1'}), vercel)).toBe('2001:db8:1:2::1');
      expect(clientAddressFromHeaders(headers({'x-forwarded-for': '  '}), vercel)).toBeNull();
    });

    it('ignore a value that is longer than 64 characters or whose first entry is not an address', () => {
      const long = `198.51.100.7, ${'10.0.0.1, '.repeat(8)}10.0.0.2`;
      expect(long.length).toBeGreaterThan(64);
      expect(clientAddressFromHeaders(headers({'x-forwarded-for': long}), vercel)).toBeNull();
      expect(clientAddressFromHeaders(headers({'x-vercel-forwarded-for': long, 'x-real-ip': '198.51.100.8'}), vercel)).toBe('198.51.100.8');
      expect(clientAddressFromHeaders(headers({'x-forwarded-for': 'unknown, 198.51.100.7'}), vercel)).toBeNull();
      expect(clientAddressFromHeaders(headers({'x-vercel-forwarded-for': 'garbage', 'x-forwarded-for': '198.51.100.7'}), vercel)).toBe('198.51.100.7');
      expect(clientAddressFromHeaders(headers({'x-forwarded-for': '203.0.113.9:443'}), vercel)).toBeNull();
    });
  });
});

describe('hash keys', () => {
  it('are read from the environment and decoded as base64 of at least 32 bytes', () => {
    const text = keyText();
    expect(hashKey({INVITATION_HASH_KEY: text}, 'INVITATION_HASH_KEY').equals(Buffer.from(text, 'base64'))).toBe(true);
  });

  it('name the variable and the problem, never the value', () => {
    const short = Buffer.alloc(16, 7).toString('base64');
    const cases: Array<[string | undefined, RegExp]> = [
      [undefined, /INVITATION_HASH_KEY is not set/],
      ['', /not set/],
      ['replace-with-local-invitation-hash-key', /placeholder/],
      ['<staging-invitation-hash-key>', /placeholder/],
      ['not base64!!', /base64/],
      [short, /at least 32 bytes/],
      ['A'.repeat(44), /not random/],
    ];
    for (const [value, message] of cases) {
      const thrown = (() => {
        try {
          hashKey({INVITATION_HASH_KEY: value}, 'INVITATION_HASH_KEY');
        } catch (error) {
          return error as Error;
        }
      })();
      expect(thrown, String(value)).toBeInstanceOf(AccountsConfigError);
      expect(thrown!.message).toMatch(message);
      if (value) expect(thrown!.message).not.toContain(value);
    }
  });
});

// A stand-in for the service-role endpoint. It records every request and answers from a table of rows.
type Call = {url: string; init: RequestInit; body: Record<string, unknown>};
function endpoint(answer: (name: string, body: Record<string, unknown>) => {status?: number; body: unknown}) {
  const calls: Call[] = [];
  const fetchImpl = async (url: string, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>;
    calls.push({url, init: init ?? {}, body});
    const reply = answer(url.split('/rpc/')[1], body);
    return new Response(JSON.stringify(reply.body), {status: reply.status ?? 200, headers: {'content-type': 'application/json'}});
  };
  return {calls, fetch: fetchImpl};
}

const SERVICE_KEY = 'service-key-must-never-appear-in-a-body';
const USER = '3f0d6c1e-8a52-4c1b-9d57-2b6a1f0e7c44';
const COMMAND = '9a1b2c3d-4e5f-4a6b-8c7d-0e1f2a3b4c5d';
const environment = (): Env => ({
  NEXT_PUBLIC_SUPABASE_URL: 'http://127.0.0.1:54321/',
  SUPABASE_SERVICE_ROLE_KEY: SERVICE_KEY,
  INVITATION_HASH_KEY: keyText(),
  RATE_LIMIT_HASH_KEY: keyText(),
});

describe('registerWithCode', () => {
  const receipt = {command_id: COMMAND, outcome: 'registered', account_id: 'a1', workspace_id: 'w1', role: 'member', replayed: false};

  it('sends hashes to the api schema with the service role, and neither the code nor the address', async () => {
    const env = environment();
    const code = generateInvitationCode();
    const address = '203.0.113.99';
    const {calls, fetch} = endpoint(() => ({body: receipt}));

    const result = await registerWithCode({userId: USER, commandId: COMMAND, code, clientAddress: address}, {env, fetch});

    expect(result).toEqual({commandId: COMMAND, outcome: 'registered', accountId: 'a1', workspaceId: 'w1', role: 'member', replayed: false});
    expect(calls).toHaveLength(1);
    const [{url, init, body}] = calls;
    expect(url).toBe('http://127.0.0.1:54321/rest/v1/rpc/register_with_code');
    expect(init.method).toBe('POST');
    expect(init.redirect).toBe('error');
    expect(init.headers).toMatchObject({'content-profile': 'api', apikey: SERVICE_KEY, authorization: `Bearer ${SERVICE_KEY}`});
    expect(body).toEqual({
      p_user_id: USER,
      p_command_id: COMMAND,
      p_code_hash: hashInvitationCode(code, hashKey(env, 'INVITATION_HASH_KEY')),
      p_origin_hash: hashClientAddress(address, hashKey(env, 'RATE_LIMIT_HASH_KEY')),
    });
    const wire = JSON.stringify(body);
    expect(wire).not.toContain(code);
    expect(wire).not.toContain(canonicalizeInvitationCode(code));
    expect(wire).not.toContain(address);
    expect(wire).not.toContain(env.INVITATION_HASH_KEY!);
    expect(wire).not.toContain(SERVICE_KEY);
  });

  it('maps every outcome, and a disabled Account is never a success', async () => {
    const env = environment();
    for (const outcome of ['refused', 'limited', 'disabled', 'no_identity'] as const) {
      const {fetch} = endpoint(() => ({body: {command_id: COMMAND, outcome, account_id: outcome === 'disabled' ? 'a1' : null, workspace_id: null, role: null, replayed: outcome === 'disabled'}}));
      const result = await registerWithCode({userId: USER, commandId: COMMAND, code: generateInvitationCode(), clientAddress: null}, {env, fetch});
      expect(result.outcome).toBe(outcome);
      expect(result.outcome).not.toBe('registered');
    }
  });

  it('refuses input that is not shaped like a code without calling the database or spending limiter budget', async () => {
    const env = environment();
    const {calls, fetch} = endpoint(() => ({body: receipt}));
    const code = generateInvitationCode();
    const malformed = ['', 'x', 'not a code', '1234', code.slice(0, -1), `${code}Z`, 'A'.repeat(10_000), ' '.repeat(600) + code, 'U'.repeat(32), undefined as unknown as string, null as unknown as string, 42 as unknown as string];
    for (const input of malformed) {
      const result = await registerWithCode({userId: USER, commandId: COMMAND, code: input, clientAddress: '203.0.113.99'}, {env, fetch});
      expect(result, String(input).slice(0, 20)).toEqual({commandId: COMMAND, outcome: 'refused', accountId: null, workspaceId: null, role: null, replayed: false});
    }
    expect(calls).toHaveLength(0);
    // A code with typographic dashes and look-alike letters is a code, and does reach the database.
    await registerWithCode({userId: USER, commandId: COMMAND, code: code.toLowerCase().replaceAll('-', '‑'), clientAddress: null}, {env, fetch});
    expect(calls).toHaveLength(1);
    expect(calls[0].body.p_code_hash).toBe(hashInvitationCode(code, hashKey(env, 'INVITATION_HASH_KEY')));
  });

  it('still reports a missing key for a malformed code, so a broken deployment is never silent', async () => {
    const {calls, fetch} = endpoint(() => ({body: receipt}));
    await expect(registerWithCode({userId: USER, commandId: COMMAND, code: 'x', clientAddress: null}, {env: {...environment(), INVITATION_HASH_KEY: undefined}, fetch})).rejects.toThrow(AccountsConfigError);
    expect(calls).toHaveLength(0);
  });

  it('fails closed: an unreachable, erroring or odd database is an error, never a success', async () => {
    const env = environment();
    const code = generateInvitationCode();
    const input = {userId: USER, commandId: COMMAND, code, clientAddress: '203.0.113.99'};

    const unreachable = async () => {
      throw new TypeError('fetch failed');
    };
    const down = await registerWithCode(input, {env, fetch: unreachable}).catch((e: unknown) => e as AccountsUnavailableError);
    expect(down).toBeInstanceOf(AccountsUnavailableError);
    expect(down).toMatchObject({retryable: true, outcomeUnknown: true, status: undefined});

    const erroring = endpoint(() => ({status: 500, body: {code: 'XX000', message: `leaks ${code}`}}));
    const error = await registerWithCode(input, {env, fetch: erroring.fetch}).catch((e: unknown) => e as AccountsUnavailableError);
    expect(error).toBeInstanceOf(AccountsUnavailableError);
    expect(error).toMatchObject({status: 500, code: 'XX000', retryable: true, outcomeUnknown: true});
    expect((error as Error).message).not.toContain(code);

    for (const odd of [{outcome: 'maybe'}, [], null, 'registered']) {
      const answer = endpoint(() => ({body: odd}));
      const thrown = await registerWithCode(input, {env, fetch: answer.fetch}).catch((e: unknown) => e as AccountsUnavailableError);
      expect(thrown, JSON.stringify(odd)).toBeInstanceOf(AccountsUnavailableError);
      // The call may have been applied, so a command that issues something must not assume it was not.
      expect(thrown, JSON.stringify(odd)).toMatchObject({retryable: false, outcomeUnknown: true});
    }
  });

  it('marks a rejected request as not retryable and its outcome as known', async () => {
    const env = environment();
    const input = {userId: USER, commandId: COMMAND, code: generateInvitationCode(), clientAddress: null};
    for (const [status, code] of [[401, '42501'], [400, '22023'], [403, '42501'], [404, 'PGRST202'], [409, '23505']] as const) {
      const {fetch} = endpoint(() => ({status, body: {code, message: 'denied'}}));
      const error = await registerWithCode(input, {env, fetch}).catch((e: unknown) => e as AccountsUnavailableError);
      expect(error, String(status)).toBeInstanceOf(AccountsUnavailableError);
      expect(error, String(status)).toMatchObject({status, code, retryable: false, outcomeUnknown: false});
    }
    for (const status of [500, 502, 503, 504]) {
      const {fetch} = endpoint(() => ({status, body: {}}));
      const error = await registerWithCode(input, {env, fetch}).catch((e: unknown) => e as AccountsUnavailableError);
      expect(error, String(status)).toMatchObject({status, retryable: true, outcomeUnknown: true});
    }
    const timeout = async () => {
      throw new DOMException('The operation timed out', 'TimeoutError');
    };
    expect(await registerWithCode(input, {env, fetch: timeout}).catch((e: unknown) => e)).toMatchObject({retryable: true, outcomeUnknown: true});
  });

  it('does not reach the network without both keys, a service key and a valid user', async () => {
    const {calls, fetch} = endpoint(() => ({body: receipt}));
    const input = {userId: USER, commandId: COMMAND, code: generateInvitationCode(), clientAddress: null};
    await expect(registerWithCode(input, {env: {...environment(), INVITATION_HASH_KEY: undefined}, fetch})).rejects.toThrow(/INVITATION_HASH_KEY is not set/);
    await expect(registerWithCode(input, {env: {...environment(), RATE_LIMIT_HASH_KEY: undefined}, fetch})).rejects.toThrow(/RATE_LIMIT_HASH_KEY is not set/);
    await expect(registerWithCode(input, {env: {...environment(), SUPABASE_SERVICE_ROLE_KEY: undefined}, fetch})).rejects.toThrow(/SUPABASE_SERVICE_ROLE_KEY is not set/);
    await expect(registerWithCode(input, {env: {...environment(), NEXT_PUBLIC_SUPABASE_URL: 'nope'}, fetch})).rejects.toThrow(/not a valid URL/);
    await expect(registerWithCode({...input, userId: 'not-a-uuid'}, {env: environment(), fetch})).rejects.toThrow(TypeError);
    await expect(registerWithCode({...input, commandId: "x'; drop table"}, {env: environment(), fetch})).rejects.toThrow(TypeError);
    expect(calls).toHaveLength(0);
  });
});

describe('the other calls', () => {
  it('consume a pre-authorization and read an account status, sending only the user ID', async () => {
    const consume = endpoint(() => ({body: {outcome: 'registered', account_id: 'a1', workspace_id: 'w1', role: 'administrator'}}));
    expect(await consumePreauthorization(USER, {env: environment(), fetch: consume.fetch})).toEqual({outcome: 'registered', accountId: 'a1', workspaceId: 'w1', role: 'administrator'});
    expect(consume.calls[0].body).toEqual({p_user_id: USER});

    const status = endpoint(() => ({body: {status: 'none', account_id: null, workspace_id: null, role: null}}));
    expect(await accountStatus(USER, {env: environment(), fetch: status.fetch})).toEqual({status: 'none', accountId: null, workspaceId: null, role: null});
    expect(status.calls[0].url).toMatch(/\/rpc\/account_status$/);
  });

  it('report a disabled Account as disabled, from both calls', async () => {
    const disabled = endpoint((name) => ({body: name === 'account_status' ? {status: 'disabled', account_id: 'a1', workspace_id: 'w1', role: 'member'} : {outcome: 'disabled', account_id: 'a1', workspace_id: 'w1', role: 'member'}}));
    expect((await consumePreauthorization(USER, {env: environment(), fetch: disabled.fetch})).outcome).toBe('disabled');
    expect((await accountStatus(USER, {env: environment(), fetch: disabled.fetch})).status).toBe('disabled');
  });

  it('seed a pre-authorization for the audited command, with the count of other administrators', async () => {
    const {calls, fetch} = endpoint(() => ({body: {preauthorization_id: 'p1', role: 'administrator', created: true, consumed: false, other_administrators: 1}}));
    const result = await seedPreauthorization({email: 'a@b.co', role: 'administrator', actor: 'seed:local:josh'}, {env: environment(), fetch});
    expect(result).toEqual({preauthorizationId: 'p1', role: 'administrator', created: true, consumed: false, otherAdministrators: 1});
    expect(calls[0].body).toEqual({p_email: 'a@b.co', p_role: 'administrator', p_actor: 'seed:local:josh'});
  });

  it('withdraw a pre-authorization', async () => {
    const {calls, fetch} = endpoint(() => ({body: {outcome: 'withdrawn'}}));
    expect(await withdrawPreauthorization({email: 'a@b.co', actor: 'seed:local:josh'}, {env: environment(), fetch})).toEqual({outcome: 'withdrawn'});
    expect(calls[0].url).toMatch(/\/rpc\/withdraw_preauthorization$/);
    expect(calls[0].body).toEqual({p_email: 'a@b.co', p_actor: 'seed:local:josh'});
  });

  it('issue a code, send only its hash and return the code to the caller once', async () => {
    const env = environment();
    const {calls, fetch} = endpoint(() => ({body: {outcome: 'issued', invitation_id: 'i1', kind: 'named', replaced_invitation_id: null}}));
    const issued = await issueInvitation({kind: 'named', label: 'Daniel', actor: 'seed:local:josh'}, {env, fetch});
    if (issued.outcome !== 'issued') throw new Error('expected an issued code');

    expect(issued.invitationId).toBe('i1');
    expect(issued.code).toMatch(/^(?:[0-9A-HJKMNP-TV-Z]{4}-){7}[0-9A-HJKMNP-TV-Z]{4}$/);
    expect(calls[0].body).toEqual({
      p_code_hash: hashInvitationCode(issued.code, hashKey(env, 'INVITATION_HASH_KEY')),
      p_kind: 'named',
      p_label: 'Daniel',
      p_actor: 'seed:local:josh',
      p_replace: false,
    });
    expect(JSON.stringify(calls[0].body)).not.toContain(issued.code);
    const again = await issueInvitation({kind: 'named', label: 'Daniel', actor: 'seed:local:josh'}, {env, fetch});
    expect(again.outcome === 'issued' && again.code !== issued.code).toBe(true);

    await issueInvitation({kind: 'general', actor: 'seed:local:josh', replace: true}, {env, fetch});
    expect(calls[2].body).toMatchObject({p_kind: 'general', p_label: null, p_replace: true});
  });

  it('return no code when the database says the invitation exists', async () => {
    const {fetch} = endpoint(() => ({body: {outcome: 'exists', invitation_id: 'i9', kind: 'general', replaced_invitation_id: null}}));
    const result = await issueInvitation({kind: 'general', actor: 'seed:local:josh'}, {env: environment(), fetch});
    expect(result).toEqual({outcome: 'exists', invitationId: 'i9', kind: 'general'});
    expect(result).not.toHaveProperty('code');
  });

  it('revoke by invitation ID or by the code, hashing the code', async () => {
    const env = environment();
    const {calls, fetch} = endpoint(() => ({body: {invitation_id: 'i1', outcome: 'revoked'}}));
    expect(await revokeInvitation({actor: 'seed:local:josh', invitationId: COMMAND}, {env, fetch})).toEqual({invitationId: 'i1', outcome: 'revoked'});
    expect(calls[0].body).toEqual({p_actor: 'seed:local:josh', p_invitation_id: COMMAND});

    const code = generateInvitationCode();
    await revokeInvitation({actor: 'seed:local:josh', code}, {env, fetch});
    expect(calls[1].body).toEqual({p_actor: 'seed:local:josh', p_code_hash: hashInvitationCode(code, hashKey(env, 'INVITATION_HASH_KEY'))});
    expect(JSON.stringify(calls[1].body)).not.toContain(code);
  });

  it('say not_found for something that cannot be a code, without calling the database', async () => {
    const {calls, fetch} = endpoint(() => ({body: {invitation_id: 'i1', outcome: 'revoked'}}));
    expect(await revokeInvitation({actor: 'seed:local:josh', code: 'not a code'}, {env: environment(), fetch})).toEqual({invitationId: null, outcome: 'not_found'});
    expect(calls).toHaveLength(0);
  });

  it('list invitations without a hash or a code', async () => {
    const rows = [
      {invitation_id: 'i1', kind: 'named', label: 'Daniel', state: 'unused', created_at: '2026-10-10T10:00:00+00:00'},
      {invitation_id: 'i2', kind: 'general', label: null, state: 'redeemed', created_at: '2026-10-09T10:00:00+00:00'},
    ];
    const {calls, fetch} = endpoint(() => ({body: rows}));
    const listed = await listInvitations({env: environment(), fetch});
    expect(listed).toEqual([
      {invitationId: 'i1', kind: 'named', label: 'Daniel', state: 'unused', createdAt: '2026-10-10T10:00:00+00:00'},
      {invitationId: 'i2', kind: 'general', label: null, state: 'redeemed', createdAt: '2026-10-09T10:00:00+00:00'},
    ]);
    expect(calls[0].url).toMatch(/\/rpc\/list_invitations$/);
    expect(JSON.stringify(listed)).not.toMatch(/hash|code/i);
    const odd = endpoint(() => ({body: {not: 'a list'}}));
    await expect(listInvitations({env: environment(), fetch: odd.fetch})).rejects.toBeInstanceOf(AccountsUnavailableError);
  });
});

// ---------------------------------------------------------------------------------------------------
describe('session grants (Story 1.4a)', () => {
  const SESSION = '3b1c9a3e-6a3e-4f19-9d0e-0a4f5e2c8d11';
  const OTHER_SESSION = '4c2d0b4f-7b4f-4a2a-8e1f-1b5a6f3d9e22';
  const ACCOUNT = '7a1b2c3d-4e5f-4a6b-8c7d-0e1f2a3b4c5d';
  const active = {state: 'active', account_id: ACCOUNT, workspace_id: 'w1', role: 'member', epoch: 2};

  describe('authorizeSession', () => {
    it('sends the user and the session to api.authorize_session with the service role, and nothing else', async () => {
      const {calls, fetch} = endpoint(() => ({body: active}));
      expect(await authorizeSession(USER, SESSION.toUpperCase(), {env: environment(), fetch})).toEqual({state: 'active', accountId: ACCOUNT, workspaceId: 'w1', role: 'member', epoch: 2, preferences: null});
      expect(calls).toHaveLength(1);
      expect(calls[0].url).toBe('http://127.0.0.1:54321/rest/v1/rpc/authorize_session');
      expect(calls[0].init.headers).toMatchObject({'content-profile': 'api', authorization: `Bearer ${SERVICE_KEY}`});
      expect(calls[0].body).toEqual({p_user_id: USER, p_session_id: SESSION});
      expect(JSON.stringify(calls[0].body)).not.toContain(SERVICE_KEY);
    });

    it.each(['unregistered', 'disabled', 'no_session', 'no_grant', 'revoked', 'expired', 'idle', 'stale_epoch', 'subject_mismatch'] as const)('answers %s with the state and nothing of the Account', async (state) => {
      const {fetch} = endpoint(() => ({body: {state, account_id: ACCOUNT, workspace_id: 'w1', role: 'administrator', epoch: 5}}));
      expect(await authorizeSession(USER, SESSION, {env: environment(), fetch})).toEqual({state, accountId: null, workspaceId: null, role: null, epoch: null, preferences: null});
    });

    it('accepts an active Account that has no Workspace row with a null Workspace', async () => {
      const {fetch} = endpoint(() => ({body: {...active, workspace_id: null}}));
      expect(await authorizeSession(USER, SESSION, {env: environment(), fetch})).toMatchObject({state: 'active', workspaceId: null});
    });

    it('carries the Account\'s preferences record as the database returned it, and null for an Account with none', async () => {
      const record = {locale: 'he', theme: 'dark', detail: 'technical', guidance: 'dismissed'};
      expect(await authorizeSession(USER, SESSION, {env: environment(), fetch: endpoint(() => ({body: {...active, preferences: record}})).fetch})).toMatchObject({state: 'active', preferences: record});
      expect(await authorizeSession(USER, SESSION, {env: environment(), fetch: endpoint(() => ({body: {...active, preferences: null}})).fetch})).toMatchObject({state: 'active', preferences: null});
    });

    it('never lets the preferences record decide: an answer without one, or with one that is not an object, is still access', async () => {
      for (const preferences of [undefined, null, 'dark', 7, true, ['dark']]) {
        const {fetch} = endpoint(() => ({body: {...active, preferences}}));
        expect(await authorizeSession(USER, SESSION, {env: environment(), fetch}), String(preferences)).toMatchObject({state: 'active', accountId: ACCOUNT, preferences: null});
      }
    });

    it('carries no record in any state that is not access, whatever the database said', async () => {
      const {fetch} = endpoint(() => ({body: {state: 'revoked', preferences: {locale: 'he', theme: 'dark', detail: 'simple', guidance: 'shown'}}}));
      expect(await authorizeSession(USER, SESSION, {env: environment(), fetch})).toMatchObject({state: 'revoked', preferences: null});
    });

    it.each([
      ['a state it does not know', {state: 'frozen'}],
      ['no state', {}],
      ['active without an Account', {...active, account_id: null}],
      ['active without a role', {...active, role: 'owner'}],
      ['active without an epoch', {...active, epoch: null}],
      ['active with a fractional epoch', {...active, epoch: 1.5}],
      ['an array', [active]],
      ['text', 'active'],
    ])('treats %s as no answer at all', async (_name, body) => {
      const {fetch} = endpoint(() => ({body}));
      await expect(authorizeSession(USER, SESSION, {env: environment(), fetch})).rejects.toBeInstanceOf(AccountsUnavailableError);
    });

    it('fails closed when the database cannot be reached, errors, or refuses the call', async () => {
      await expect(authorizeSession(USER, SESSION, {env: environment(), fetch: async () => { throw new TypeError('fetch failed'); }})).rejects.toMatchObject({retryable: true});
      await expect(authorizeSession(USER, SESSION, {env: environment(), fetch: endpoint(() => ({status: 503, body: {}})).fetch})).rejects.toMatchObject({retryable: true, status: 503});
      await expect(authorizeSession(USER, SESSION, {env: environment(), fetch: endpoint(() => ({status: 403, body: {code: '42501'}})).fetch})).rejects.toMatchObject({retryable: false, code: '42501'});
    });

    it('refuses an ID that is not a UUID without calling the database', async () => {
      const {calls, fetch} = endpoint(() => ({body: active}));
      await expect(authorizeSession('not-a-uuid', SESSION, {env: environment(), fetch})).rejects.toThrow(TypeError);
      await expect(authorizeSession(USER, "x'; drop table", {env: environment(), fetch})).rejects.toThrow(TypeError);
      expect(calls).toHaveLength(0);
    });
  });

  describe('issueGrant', () => {
    it('sends the user and the session, and returns the receipt', async () => {
      const {calls, fetch} = endpoint(() => ({body: {outcome: 'issued', account_id: ACCOUNT, epoch: 1}}));
      expect(await issueGrant(USER, SESSION, {env: environment(), fetch})).toEqual({outcome: 'issued', accountId: ACCOUNT, epoch: 1});
      expect(calls[0].url).toMatch(/\/rpc\/issue_grant$/);
      expect(calls[0].body).toEqual({p_user_id: USER, p_session_id: SESSION});
    });

    it.each(['issued', 'exists', 'revoked', 'expired', 'idle', 'stale', 'disabled', 'no_session', 'subject_mismatch'] as const)('maps the %s outcome, with the Account and epoch it names', async (outcome) => {
      const {fetch} = endpoint(() => ({body: {outcome, account_id: ACCOUNT, epoch: 4}}));
      expect(await issueGrant(USER, SESSION, {env: environment(), fetch})).toEqual({outcome, accountId: ACCOUNT, epoch: 4});
    });

    it('maps no_account, which names neither an Account nor an epoch', async () => {
      const {fetch} = endpoint(() => ({body: {outcome: 'no_account', account_id: null, epoch: null}}));
      expect(await issueGrant(USER, SESSION, {env: environment(), fetch})).toEqual({outcome: 'no_account', accountId: null, epoch: null});
    });

    it.each([
      ['an outcome it does not know', {outcome: 'granted', account_id: ACCOUNT, epoch: 1}],
      ['an Account\'s outcome with no epoch', {outcome: 'exists', account_id: ACCOUNT, epoch: null}],
      ['an Account\'s outcome with an epoch that is not a number', {outcome: 'issued', account_id: ACCOUNT, epoch: 'one'}],
      ['an Account\'s outcome with no Account', {outcome: 'issued', account_id: null, epoch: 1}],
    ])('treats %s as no answer at all', async (_name, body) => {
      const {fetch} = endpoint(() => ({body}));
      await expect(issueGrant(USER, SESSION, {env: environment(), fetch})).rejects.toBeInstanceOf(AccountsUnavailableError);
    });

    it('refuses a bad ID without calling', async () => {
      const {calls, fetch} = endpoint(() => ({body: {outcome: 'issued', account_id: ACCOUNT, epoch: 1}}));
      await expect(issueGrant(USER, 'nope', {env: environment(), fetch})).rejects.toThrow(TypeError);
      expect(calls).toHaveLength(0);
    });
  });

  describe('revocation', () => {
    const actor = `user:${USER}`;
    const reply = (revoked: number, live = revoked) => endpoint(() => ({body: {revoked, live}}));

    it('revokes one session, optionally for one user, naming only IDs the server took from a verified session', async () => {
      const {calls, fetch} = reply(1);
      expect(await revokeSessionGrant({sessionId: SESSION, userId: USER, actor, reason: 'sign_out'}, {env: environment(), fetch})).toEqual({revoked: 1, live: 1});
      expect(calls[0].url).toMatch(/\/rpc\/revoke_grants$/);
      expect(calls[0].body).toEqual({p_actor: actor, p_reason: 'sign_out', p_session_id: SESSION, p_user_id: USER});
      await revokeSessionGrant({sessionId: SESSION, actor: 'system:authorization', reason: 'recovery'}, {env: environment(), fetch});
      expect(calls[1].body).toEqual({p_actor: 'system:authorization', p_reason: 'recovery', p_session_id: SESSION, p_user_id: null});
    });

    it('revokes every grant of an Account, sparing one session when asked', async () => {
      const {calls, fetch} = reply(3, 2);
      expect(await revokeAccountGrants({accountId: ACCOUNT, exceptSessionId: OTHER_SESSION, actor, reason: 'sign_out_others'}, {env: environment(), fetch})).toEqual({revoked: 3, live: 2});
      expect(calls[0].body).toEqual({p_actor: actor, p_reason: 'sign_out_others', p_account_id: ACCOUNT, p_except_session_id: OTHER_SESSION});
      await revokeAccountGrants({accountId: ACCOUNT, actor, reason: 'disabled'}, {env: environment(), fetch});
      expect(calls[1].body).toMatchObject({p_account_id: ACCOUNT, p_except_session_id: null});
    });

    it('revokes the grants of an Account that were issued under a lower epoch', async () => {
      const {calls, fetch} = reply(2, 0);
      expect(await revokeGrantsBelowEpoch({accountId: ACCOUNT, belowEpoch: 4, actor, reason: 'recovery'}, {env: environment(), fetch})).toEqual({revoked: 2, live: 0});
      expect(calls[0].body).toEqual({p_actor: actor, p_reason: 'recovery', p_account_id: ACCOUNT, p_below_epoch: 4});
    });

    it('raises an epoch', async () => {
      const {calls, fetch} = endpoint(() => ({body: {account_id: ACCOUNT, epoch: 3}}));
      expect(await raiseAuthorizationEpoch({accountId: ACCOUNT, actor}, {env: environment(), fetch})).toEqual({accountId: ACCOUNT, epoch: 3});
      expect(calls[0].url).toMatch(/\/rpc\/raise_authorization_epoch$/);
      expect(calls[0].body).toEqual({p_account_id: ACCOUNT, p_actor: actor});
      const unknown = endpoint(() => ({body: {account_id: ACCOUNT, epoch: null}}));
      expect(await raiseAuthorizationEpoch({accountId: ACCOUNT, actor}, {env: environment(), fetch: unknown.fetch})).toEqual({accountId: ACCOUNT, epoch: null});
    });

    it('does not read an epoch that is not a number as an unknown Account: it is no answer at all', async () => {
      for (const epoch of ['3', 1.5, -1, true, {}, undefined]) {
        const {fetch} = endpoint(() => ({body: epoch === undefined ? {account_id: ACCOUNT} : {account_id: ACCOUNT, epoch}}));
        await expect(raiseAuthorizationEpoch({accountId: ACCOUNT, actor}, {env: environment(), fetch}), String(epoch)).rejects.toBeInstanceOf(AccountsUnavailableError);
      }
    });

    it('refuses an actor, a reason or an ID of the wrong shape without calling the database', async () => {
      const {calls, fetch} = reply(0);
      const options = {env: environment(), fetch};
      await expect(revokeSessionGrant({sessionId: SESSION, actor: 'Not An Actor', reason: 'sign_out'}, options)).rejects.toThrow(TypeError);
      await expect(revokeSessionGrant({sessionId: SESSION, actor, reason: 'Sign Out!'}, options)).rejects.toThrow(TypeError);
      await expect(revokeSessionGrant({sessionId: 'nope', actor, reason: 'sign_out'}, options)).rejects.toThrow(TypeError);
      await expect(revokeAccountGrants({accountId: 'nope', actor, reason: 'x'}, options)).rejects.toThrow(TypeError);
      await expect(revokeGrantsBelowEpoch({accountId: ACCOUNT, belowEpoch: 0, actor, reason: 'x'}, options)).rejects.toThrow(TypeError);
      await expect(revokeGrantsBelowEpoch({accountId: ACCOUNT, belowEpoch: 1.5, actor, reason: 'x'}, options)).rejects.toThrow(TypeError);
      await expect(raiseAuthorizationEpoch({accountId: ACCOUNT, actor: ''}, options)).rejects.toThrow(TypeError);
      expect(calls).toHaveLength(0);
    });

    it('throws, so the caller knows nothing was recorded, when the database fails or answers nonsense', async () => {
      const options = (fetch: ReturnType<typeof endpoint>['fetch']) => ({env: environment(), fetch});
      await expect(revokeSessionGrant({sessionId: SESSION, actor, reason: 'sign_out'}, options(async () => { throw new TypeError('fetch failed'); }))).rejects.toMatchObject({retryable: true, outcomeUnknown: true});
      await expect(revokeSessionGrant({sessionId: SESSION, actor, reason: 'sign_out'}, options(endpoint(() => ({status: 500, body: {}})).fetch))).rejects.toBeInstanceOf(AccountsUnavailableError);
      for (const body of [{revoked: 'many', live: 0}, {revoked: -1, live: 0}, {revoked: 1}, {revoked: 1, live: 2}, {live: 1}]) {
        await expect(revokeAccountGrants({accountId: ACCOUNT, actor, reason: 'x'}, options(endpoint(() => ({body})).fetch)), JSON.stringify(body)).rejects.toBeInstanceOf(AccountsUnavailableError);
      }
    });
  });
});

// ---------------------------------------------------------------------------------------------------
describe('confirmRegistration (Story 1.4a)', () => {
  const COMMAND_ID = '9a1b2c3d-4e5f-4a6b-8c7d-0e1f2a3b4c5d';

  it('sends the hash of the code, never the code, and returns what the database confirms', async () => {
    const env = environment();
    const code = generateInvitationCode();
    const yes = endpoint(() => ({body: {confirmed: true}}));
    expect(await confirmRegistration({userId: USER, commandId: COMMAND_ID, code}, {env, fetch: yes.fetch})).toBe(true);
    expect(yes.calls[0].url).toMatch(/\/rpc\/confirm_registration$/);
    expect(yes.calls[0].body).toEqual({p_user_id: USER, p_command_id: COMMAND_ID, p_code_hash: hashInvitationCode(code, hashKey(env, 'INVITATION_HASH_KEY'))});
    expect(JSON.stringify(yes.calls[0].body)).not.toContain(code);
    const no = endpoint(() => ({body: {confirmed: false}}));
    expect(await confirmRegistration({userId: USER, commandId: COMMAND_ID, code}, {env, fetch: no.fetch})).toBe(false);
  });

  it('is false, without calling the database, for something that is not shaped like a code', async () => {
    const {calls, fetch} = endpoint(() => ({body: {confirmed: true}}));
    expect(await confirmRegistration({userId: USER, commandId: COMMAND_ID, code: 'nope'}, {env: environment(), fetch})).toBe(false);
    expect(calls).toHaveLength(0);
  });

  it('treats an answer that is not a plain true or false as no answer, and a missing key as an error', async () => {
    const code = generateInvitationCode();
    for (const body of [{}, {confirmed: 'true'}, {confirmed: 1}, [true]]) {
      await expect(confirmRegistration({userId: USER, commandId: COMMAND_ID, code}, {env: environment(), fetch: endpoint(() => ({body})).fetch}), JSON.stringify(body)).rejects.toBeInstanceOf(AccountsUnavailableError);
    }
    await expect(confirmRegistration({userId: USER, commandId: COMMAND_ID, code}, {env: {...environment(), INVITATION_HASH_KEY: undefined}, fetch: endpoint(() => ({body: {confirmed: true}})).fetch})).rejects.toBeInstanceOf(AccountsConfigError);
  });
});

// ---------------------------------------------------------------------------------------------------
describe('CSRF tokens (Story 1.4c)', () => {
  const SESSION = '3b1c9a3e-6a3e-4f19-9d0e-0a4f5e2c8d11';
  const HASH = 'ab'.repeat(32);

  describe('issueCsrf', () => {
    it('sends the user, the session and the hash to api.issue_csrf with the service role, and nothing else', async () => {
      const {calls, fetch} = endpoint(() => ({body: {outcome: 'issued'}}));
      expect(await issueCsrf({userId: USER.toUpperCase(), sessionId: SESSION.toUpperCase(), hash: HASH}, {env: environment(), fetch})).toBe('issued');
      expect(calls).toHaveLength(1);
      expect(calls[0].url).toBe('http://127.0.0.1:54321/rest/v1/rpc/issue_csrf');
      expect(calls[0].init.headers).toMatchObject({'content-profile': 'api', authorization: `Bearer ${SERVICE_KEY}`});
      expect(calls[0].body).toEqual({p_user_id: USER, p_session_id: SESSION, p_csrf_hash: HASH});
      expect(JSON.stringify(calls[0].body)).not.toContain(SERVICE_KEY);
    });

    it.each(['issued', 'exists', 'denied'] as const)('maps the %s outcome', async (outcome) => {
      const {fetch} = endpoint(() => ({body: {outcome}}));
      expect(await issueCsrf({userId: USER, sessionId: SESSION, hash: HASH}, {env: environment(), fetch})).toBe(outcome);
    });

    it.each([
      ['an outcome it does not know', {outcome: 'minted'}],
      ['a verification\'s outcome', {outcome: 'valid'}],
      ['no outcome', {}],
      ['an array', [{outcome: 'issued'}]],
      ['text', 'issued'],
    ])('treats %s as no answer at all', async (_name, body) => {
      const {fetch} = endpoint(() => ({body}));
      await expect(issueCsrf({userId: USER, sessionId: SESSION, hash: HASH}, {env: environment(), fetch})).rejects.toBeInstanceOf(AccountsUnavailableError);
    });

    it('fails closed when the database cannot be reached, errors, or refuses the call', async () => {
      const input = {userId: USER, sessionId: SESSION, hash: HASH};
      await expect(issueCsrf(input, {env: environment(), fetch: async () => { throw new TypeError('fetch failed'); }})).rejects.toMatchObject({retryable: true});
      await expect(issueCsrf(input, {env: environment(), fetch: endpoint(() => ({status: 503, body: {}})).fetch})).rejects.toMatchObject({retryable: true, status: 503});
      await expect(issueCsrf(input, {env: environment(), fetch: endpoint(() => ({status: 403, body: {code: '42501'}})).fetch})).rejects.toMatchObject({retryable: false, code: '42501'});
    });

    it('refuses an ID that is not a UUID, or a hash that is not a SHA-256, without calling the database', async () => {
      const {calls, fetch} = endpoint(() => ({body: {outcome: 'issued'}}));
      await expect(issueCsrf({userId: 'x', sessionId: SESSION, hash: HASH}, {env: environment(), fetch})).rejects.toThrow(TypeError);
      await expect(issueCsrf({userId: USER, sessionId: "x'; drop table", hash: HASH}, {env: environment(), fetch})).rejects.toThrow(TypeError);
      for (const hash of ['', 'AB'.repeat(32), 'ab'.repeat(31), `${'ab'.repeat(32)}0`, 'g'.repeat(64), 'a token, not its hash']) {
        await expect(issueCsrf({userId: USER, sessionId: SESSION, hash}, {env: environment(), fetch}), hash).rejects.toThrow(TypeError);
      }
      expect(calls).toHaveLength(0);
    });
  });

  describe('verifyCsrf', () => {
    it('sends the user, the session and the hash to api.verify_csrf with the service role', async () => {
      const {calls, fetch} = endpoint(() => ({body: {outcome: 'valid'}}));
      expect(await verifyCsrf({userId: USER, sessionId: SESSION, hash: HASH}, {env: environment(), fetch})).toBe('valid');
      expect(calls[0].url).toBe('http://127.0.0.1:54321/rest/v1/rpc/verify_csrf');
      expect(calls[0].init.headers).toMatchObject({'content-profile': 'api', authorization: `Bearer ${SERVICE_KEY}`});
      expect(calls[0].body).toEqual({p_user_id: USER, p_session_id: SESSION, p_csrf_hash: HASH});
    });

    it.each(['valid', 'invalid', 'denied'] as const)('maps the %s outcome', async (outcome) => {
      const {fetch} = endpoint(() => ({body: {outcome}}));
      expect(await verifyCsrf({userId: USER, sessionId: SESSION, hash: HASH}, {env: environment(), fetch})).toBe(outcome);
    });

    it.each([
      ['an outcome it does not know', {outcome: 'ok'}],
      ['an issue\'s outcome', {outcome: 'issued'}],
      ['no outcome', {}],
      ['a boolean', {outcome: true}],
      ['text', 'valid'],
    ])('treats %s as no answer at all, never as permission', async (_name, body) => {
      const {fetch} = endpoint(() => ({body}));
      await expect(verifyCsrf({userId: USER, sessionId: SESSION, hash: HASH}, {env: environment(), fetch})).rejects.toBeInstanceOf(AccountsUnavailableError);
    });

    it('fails closed when the database cannot be reached, so the caller refuses the request as retryable', async () => {
      await expect(verifyCsrf({userId: USER, sessionId: SESSION, hash: HASH}, {env: environment(), fetch: async () => { throw new TypeError('fetch failed'); }})).rejects.toMatchObject({retryable: true});
      await expect(verifyCsrf({userId: USER, sessionId: SESSION, hash: HASH}, {env: environment(), fetch: endpoint(() => ({status: 500, body: {}})).fetch})).rejects.toMatchObject({retryable: true});
    });

    it('refuses a bad ID or hash without calling', async () => {
      const {calls, fetch} = endpoint(() => ({body: {outcome: 'valid'}}));
      await expect(verifyCsrf({userId: USER, sessionId: 'nope', hash: HASH}, {env: environment(), fetch})).rejects.toThrow(TypeError);
      await expect(verifyCsrf({userId: USER, sessionId: SESSION, hash: 'raw-token'}, {env: environment(), fetch})).rejects.toThrow(TypeError);
      expect(calls).toHaveLength(0);
    });
  });
});

// ---------------------------------------------------------------------------------------------------
describe('the preferences record (Story 1.4d)', () => {
  const ACCOUNT = '7a1b2c3d-4e5f-4a6b-8c7d-0e1f2a3b4c5d';
  const device = {accountId: ACCOUNT, locale: 'he', theme: 'dark', detail: 'technical', guidance: 'dismissed'};

  describe('adoptPreferences', () => {
    it('sends the Account the server derived and the four values to api.adopt_preferences with the service role, and nothing else', async () => {
      const {calls, fetch} = endpoint(() => ({body: {outcome: 'created'}}));
      expect(await adoptPreferences({...device, accountId: ACCOUNT.toUpperCase()}, {env: environment(), fetch})).toBe('created');
      expect(calls).toHaveLength(1);
      expect(calls[0].url).toBe('http://127.0.0.1:54321/rest/v1/rpc/adopt_preferences');
      expect(calls[0].init.headers).toMatchObject({'content-profile': 'api', authorization: `Bearer ${SERVICE_KEY}`});
      expect(calls[0].body).toEqual({p_account_id: ACCOUNT, p_locale: 'he', p_theme: 'dark', p_detail: 'technical', p_guidance: 'dismissed'});
      expect(JSON.stringify(calls[0].body)).not.toContain(SERVICE_KEY);
    });

    it('sends a null language as null: no language was chosen', async () => {
      const {calls, fetch} = endpoint(() => ({body: {outcome: 'created'}}));
      await adoptPreferences({...device, locale: null}, {env: environment(), fetch});
      expect(calls[0].body).toMatchObject({p_locale: null});
    });

    it.each(['created', 'exists', 'denied'] as const)('maps the %s outcome', async (outcome) => {
      const {fetch} = endpoint(() => ({body: {outcome}}));
      expect(await adoptPreferences(device, {env: environment(), fetch})).toBe(outcome);
    });

    it.each([
      ['an outcome it does not know', {outcome: 'adopted'}],
      ['a save\'s outcome', {outcome: 'saved'}],
      ['no outcome', {}],
      ['text', 'created'],
    ])('treats %s as no answer at all', async (_name, body) => {
      const {fetch} = endpoint(() => ({body}));
      await expect(adoptPreferences(device, {env: environment(), fetch})).rejects.toBeInstanceOf(AccountsUnavailableError);
    });

    it('fails closed when the database cannot be reached, errors, or refuses the call, so nothing is known to be stored', async () => {
      await expect(adoptPreferences(device, {env: environment(), fetch: async () => { throw new TypeError('fetch failed'); }})).rejects.toMatchObject({retryable: true});
      await expect(adoptPreferences(device, {env: environment(), fetch: endpoint(() => ({status: 503, body: {}})).fetch})).rejects.toMatchObject({retryable: true, status: 503});
      await expect(adoptPreferences(device, {env: environment(), fetch: endpoint(() => ({status: 400, body: {code: '22023'}})).fetch})).rejects.toMatchObject({retryable: false, code: '22023'});
    });

    it('refuses an Account that is not a UUID, and a value that is not a short word, without calling the database', async () => {
      const {calls, fetch} = endpoint(() => ({body: {outcome: 'created'}}));
      await expect(adoptPreferences({...device, accountId: 'x'}, {env: environment(), fetch})).rejects.toThrow(TypeError);
      await expect(adoptPreferences({...device, accountId: "x'; drop table"}, {env: environment(), fetch})).rejects.toThrow(TypeError);
      for (const patch of [{theme: ''}, {theme: 'x'.repeat(40)}, {detail: ''}, {guidance: ''}, {locale: ''}, {theme: null}, {detail: 7}, {guidance: undefined}]) {
        await expect(adoptPreferences({...device, ...patch} as never, {env: environment(), fetch}), JSON.stringify(patch)).rejects.toThrow(TypeError);
      }
      expect(calls).toHaveLength(0);
    });
  });

  describe('setAccountPreference', () => {
    it('sends the Account the server derived, the name and the value to api.set_preference with the service role', async () => {
      const {calls, fetch} = endpoint(() => ({body: {outcome: 'saved'}}));
      expect(await setAccountPreference({accountId: ACCOUNT.toUpperCase(), name: 'theme', value: 'dark'}, {env: environment(), fetch})).toBe('saved');
      expect(calls[0].url).toBe('http://127.0.0.1:54321/rest/v1/rpc/set_preference');
      expect(calls[0].init.headers).toMatchObject({'content-profile': 'api', authorization: `Bearer ${SERVICE_KEY}`});
      expect(calls[0].body).toEqual({p_account_id: ACCOUNT, p_name: 'theme', p_value: 'dark'});
    });

    it('sends a null language ("match my device"), and only for the language', async () => {
      const {calls, fetch} = endpoint(() => ({body: {outcome: 'saved'}}));
      expect(await setAccountPreference({accountId: ACCOUNT, name: 'locale', value: null}, {env: environment(), fetch})).toBe('saved');
      expect(calls[0].body).toEqual({p_account_id: ACCOUNT, p_name: 'locale', p_value: null});
      for (const name of ['theme', 'detail', 'guidance']) {
        await expect(setAccountPreference({accountId: ACCOUNT, name, value: null}, {env: environment(), fetch}), name).rejects.toThrow(TypeError);
      }
      expect(calls).toHaveLength(1);
    });

    it.each(['saved', 'denied'] as const)('maps the %s outcome', async (outcome) => {
      const {fetch} = endpoint(() => ({body: {outcome}}));
      expect(await setAccountPreference({accountId: ACCOUNT, name: 'detail', value: 'technical'}, {env: environment(), fetch})).toBe(outcome);
    });

    it.each([
      ['an outcome it does not know', {outcome: 'ok'}],
      ['an adoption\'s outcome', {outcome: 'created'}],
      ['no outcome', {}],
    ])('treats %s as no answer at all, never as a saved choice', async (_name, body) => {
      const {fetch} = endpoint(() => ({body}));
      await expect(setAccountPreference({accountId: ACCOUNT, name: 'theme', value: 'dark'}, {env: environment(), fetch})).rejects.toBeInstanceOf(AccountsUnavailableError);
    });

    it('fails closed when the database cannot be reached, errors, or refuses the call', async () => {
      const input = {accountId: ACCOUNT, name: 'theme', value: 'dark'};
      await expect(setAccountPreference(input, {env: environment(), fetch: async () => { throw new TypeError('fetch failed'); }})).rejects.toMatchObject({retryable: true});
      await expect(setAccountPreference(input, {env: environment(), fetch: endpoint(() => ({status: 500, body: {}})).fetch})).rejects.toMatchObject({retryable: true});
      await expect(setAccountPreference(input, {env: environment(), fetch: endpoint(() => ({status: 400, body: {code: '22023'}})).fetch})).rejects.toMatchObject({retryable: false, code: '22023'});
    });

    it('refuses a bad Account, name or value without calling the database', async () => {
      const {calls, fetch} = endpoint(() => ({body: {outcome: 'saved'}}));
      await expect(setAccountPreference({accountId: 'nope', name: 'theme', value: 'dark'}, {env: environment(), fetch})).rejects.toThrow(TypeError);
      for (const name of ['', 'font', 'Theme', 'theme; drop', 'locale ', undefined, 7]) {
        await expect(setAccountPreference({accountId: ACCOUNT, name: name as never, value: 'dark'}, {env: environment(), fetch}), String(name)).rejects.toThrow(TypeError);
      }
      for (const value of ['', 'x'.repeat(40), 7, undefined]) {
        await expect(setAccountPreference({accountId: ACCOUNT, name: 'theme', value: value as never}, {env: environment(), fetch}), String(value)).rejects.toThrow(TypeError);
      }
      expect(calls).toHaveLength(0);
    });
  });
});

// ---------------------------------------------------------------------------------------------------
describe('recordInvitationRefusal (Story 1.11)', () => {
  const INVITATION = '9d8c7b6a-5f4e-4d3c-8b2a-1f0e9d8c7b6a';

  it('names the three refusals the database records, and no others', () => {
    expect([...invitationRefusalActions]).toEqual(['invitation.issue_refused', 'invitation.revoke_refused', 'invitation.denied']);
  });

  it('sends the verified Auth user, the action and the invitation to api.record_invitation_refusal with the service role, and nothing else', async () => {
    const {calls, fetch} = endpoint(() => ({body: {outcome: 'recorded'}}));
    expect(await recordInvitationRefusal({userId: USER.toUpperCase(), action: 'invitation.revoke_refused', invitationId: INVITATION.toUpperCase()}, {env: environment(), fetch})).toBe('recorded');
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe('http://127.0.0.1:54321/rest/v1/rpc/record_invitation_refusal');
    expect(calls[0].init.headers).toMatchObject({'content-profile': 'api', authorization: `Bearer ${SERVICE_KEY}`});
    expect(calls[0].body).toEqual({p_user_id: USER, p_action: 'invitation.revoke_refused', p_invitation_id: INVITATION});
    expect(JSON.stringify(calls[0].body)).not.toContain(SERVICE_KEY);
  });

  it('sends no invitation for an issue, and takes no label, code, hash, marker outcome or reason at all', async () => {
    const {calls, fetch} = endpoint(() => ({body: {outcome: 'repeated'}}));
    expect(await recordInvitationRefusal({userId: USER, action: 'invitation.issue_refused'}, {env: environment(), fetch})).toBe('repeated');
    expect(await recordInvitationRefusal({userId: USER, action: 'invitation.denied', invitationId: null}, {env: environment(), fetch})).toBe('repeated');
    for (const call of calls) expect(Object.keys(call.body as object).sort()).toEqual(['p_action', 'p_invitation_id', 'p_user_id']);
    expect(calls[0].body).toEqual({p_user_id: USER, p_action: 'invitation.issue_refused', p_invitation_id: null});
    // Extra fields in the input go nowhere: the typed call builds the body from the three it knows.
    await recordInvitationRefusal({userId: USER, action: 'invitation.issue_refused', label: 'Daniel', code: 'ABCD', reason: 'expired'} as never, {env: environment(), fetch});
    expect(JSON.stringify(calls[2].body)).not.toMatch(/Daniel|ABCD|expired/);
  });

  it.each(['recorded', 'repeated'] as const)('maps the %s outcome', async (outcome) => {
    const {fetch} = endpoint(() => ({body: {outcome}}));
    expect(await recordInvitationRefusal({userId: USER, action: 'invitation.denied'}, {env: environment(), fetch})).toBe(outcome);
  });

  it.each([
    ['an outcome it does not know', {outcome: 'ok'}],
    ['an issue\'s outcome', {outcome: 'issued'}],
    ['no outcome', {}],
    ['text', 'recorded'],
  ])('treats %s as no answer at all', async (_name, body) => {
    const {fetch} = endpoint(() => ({body}));
    await expect(recordInvitationRefusal({userId: USER, action: 'invitation.denied'}, {env: environment(), fetch})).rejects.toBeInstanceOf(AccountsUnavailableError);
  });

  it('fails closed when the database cannot be reached, errors, or refuses the call', async () => {
    const input = {userId: USER, action: 'invitation.denied'} as const;
    await expect(recordInvitationRefusal(input, {env: environment(), fetch: async () => { throw new TypeError('fetch failed'); }})).rejects.toMatchObject({retryable: true});
    await expect(recordInvitationRefusal(input, {env: environment(), fetch: endpoint(() => ({status: 503, body: {}})).fetch})).rejects.toMatchObject({retryable: true, status: 503});
    await expect(recordInvitationRefusal(input, {env: environment(), fetch: endpoint(() => ({status: 400, body: {code: '22023'}})).fetch})).rejects.toMatchObject({retryable: false, code: '22023'});
  });

  it('refuses an action it does not know, and an ID that is not a UUID, without calling the database', async () => {
    const {calls, fetch} = endpoint(() => ({body: {outcome: 'recorded'}}));
    for (const action of ['invitation.issued', 'invitation.revoked', 'invitation.refused', 'step_up.limited', '', undefined, 7]) {
      await expect(recordInvitationRefusal({userId: USER, action: action as never}, {env: environment(), fetch}), String(action)).rejects.toThrow(TypeError);
    }
    await expect(recordInvitationRefusal({userId: 'nope', action: 'invitation.denied'}, {env: environment(), fetch})).rejects.toThrow(TypeError);
    await expect(recordInvitationRefusal({userId: USER, action: 'invitation.revoke_refused', invitationId: "x'; drop table"}, {env: environment(), fetch})).rejects.toThrow(TypeError);
    expect(calls).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------------------------------
describe('Account administration (Story 1.5)', () => {
  const ACCOUNT = '7a1b2c3d-4e5f-4a6b-8c7d-0e1f2a3b4c5d';
  const ACTOR = `user:${USER}`;
  const row = {account_id: ACCOUNT, email: 'dana@example.com', invitation_kind: 'named', invitation_label: 'Dana', role: 'member', status: 'active', created_at: '2026-10-12T00:24:11.123456+00:00'};

  describe('listAccounts', () => {
    it('calls api.list_accounts with the service role, no argument, and maps each row', async () => {
      const {calls, fetch} = endpoint(() => ({body: [row, {...row, account_id: USER, email: null, invitation_kind: null, invitation_label: null, role: 'administrator', status: 'disabled'}]}));
      expect(await listAccounts({env: environment(), fetch})).toEqual([
        {accountId: ACCOUNT, email: 'dana@example.com', invitationKind: 'named', invitationLabel: 'Dana', role: 'member', status: 'active', createdAt: '2026-10-12T00:24:11.123456+00:00'},
        {accountId: USER, email: null, invitationKind: null, invitationLabel: null, role: 'administrator', status: 'disabled', createdAt: '2026-10-12T00:24:11.123456+00:00'},
      ]);
      expect(calls[0].url).toBe('http://127.0.0.1:54321/rest/v1/rpc/list_accounts');
      expect(calls[0].body).toEqual({});
      expect(calls[0].init.headers).toMatchObject({'content-profile': 'api', authorization: `Bearer ${SERVICE_KEY}`});
    });

    it('answers an empty list, and refuses an answer that is not a list or has a row it cannot read', async () => {
      expect(await listAccounts({env: environment(), fetch: endpoint(() => ({body: []})).fetch})).toEqual([]);
      for (const body of [{}, 'rows', null, [{...row, account_id: null}], [{...row, role: 'owner'}], [{...row, status: 'banned'}], [{...row, invitation_kind: 'special'}], ['x']]) {
        await expect(listAccounts({env: environment(), fetch: endpoint(() => ({body})).fetch}), JSON.stringify(body)).rejects.toBeInstanceOf(AccountsUnavailableError);
      }
    });

    it('fails closed when the database cannot be reached, errors, or refuses the call', async () => {
      await expect(listAccounts({env: environment(), fetch: async () => { throw new TypeError('fetch failed'); }})).rejects.toMatchObject({retryable: true});
      await expect(listAccounts({env: environment(), fetch: endpoint(() => ({status: 503, body: {}})).fetch})).rejects.toMatchObject({retryable: true, status: 503});
    });
  });

  describe('disableAccount', () => {
    const done = {outcome: 'disabled', sessions_ended: 2, grants_revoked: 3, epoch: 4};

    it('sends the actor and the Account to api.disable_account and nothing else, and maps the receipt', async () => {
      const {calls, fetch} = endpoint(() => ({body: done}));
      expect(await disableAccount({accountId: ACCOUNT.toUpperCase(), actor: ACTOR}, {env: environment(), fetch})).toEqual({outcome: 'disabled', sessionsEnded: 2, grantsRevoked: 3, epoch: 4});
      expect(calls).toHaveLength(1);
      expect(calls[0].url).toBe('http://127.0.0.1:54321/rest/v1/rpc/disable_account');
      expect(calls[0].body).toEqual({p_actor: ACTOR, p_account_id: ACCOUNT});
      expect(JSON.stringify(calls[0].body)).not.toContain(SERVICE_KEY);
    });

    it.each(['already_disabled', 'administrator', 'not_found'] as const)('maps %s, with no counts', async (outcome) => {
      const {fetch} = endpoint(() => ({body: {outcome, sessions_ended: null, grants_revoked: null, epoch: outcome === 'not_found' ? null : 2}}));
      expect(await disableAccount({accountId: ACCOUNT, actor: ACTOR}, {env: environment(), fetch})).toEqual({outcome, sessionsEnded: 0, grantsRevoked: 0, epoch: outcome === 'not_found' ? null : 2});
    });

    it.each([
      ['an outcome it does not know', {outcome: 'done'}],
      ['a disable that does not say how many sessions ended', {...done, sessions_ended: null}],
      ['a disable that does not say how many grants ended', {...done, grants_revoked: undefined}],
      ['a disable that does not name the epoch', {...done, epoch: null}],
      ['a count that is not a number', {...done, sessions_ended: 'two'}],
      ['a negative count', {...done, sessions_ended: -1}],
      ['text', 'disabled'],
    ])('treats %s as no answer at all', async (_name, body) => {
      const {fetch} = endpoint(() => ({body}));
      await expect(disableAccount({accountId: ACCOUNT, actor: ACTOR}, {env: environment(), fetch})).rejects.toBeInstanceOf(AccountsUnavailableError);
    });

    it('says, when it throws, whether the change may have been made', async () => {
      const input = {accountId: ACCOUNT, actor: ACTOR};
      await expect(disableAccount(input, {env: environment(), fetch: async () => { throw new TypeError('fetch failed'); }})).rejects.toMatchObject({retryable: true, outcomeUnknown: true});
      await expect(disableAccount(input, {env: environment(), fetch: endpoint(() => ({status: 503, body: {}})).fetch})).rejects.toMatchObject({retryable: true, outcomeUnknown: true});
      await expect(disableAccount(input, {env: environment(), fetch: endpoint(() => ({status: 400, body: {code: '22023'}})).fetch})).rejects.toMatchObject({retryable: false, outcomeUnknown: false, code: '22023'});
    });

    it('refuses a bad Account ID or actor without calling the database', async () => {
      const {calls, fetch} = endpoint(() => ({body: done}));
      await expect(disableAccount({accountId: 'nope', actor: ACTOR}, {env: environment(), fetch})).rejects.toThrow(TypeError);
      await expect(disableAccount({accountId: "x'; drop table", actor: ACTOR}, {env: environment(), fetch})).rejects.toThrow(TypeError);
      for (const actor of ['', 'User:1', 'user:', 'user:a b', 'user:' + 'x'.repeat(65)]) await expect(disableAccount({accountId: ACCOUNT, actor}, {env: environment(), fetch}), actor).rejects.toThrow(TypeError);
      expect(calls).toHaveLength(0);
    });
  });

  describe('enableAccount', () => {
    it('sends the actor and the Account to api.enable_account and maps the receipt', async () => {
      const {calls, fetch} = endpoint(() => ({body: {outcome: 'enabled', epoch: 5}}));
      expect(await enableAccount({accountId: ACCOUNT, actor: ACTOR}, {env: environment(), fetch})).toEqual({outcome: 'enabled', epoch: 5});
      expect(calls[0].url).toBe('http://127.0.0.1:54321/rest/v1/rpc/enable_account');
      expect(calls[0].body).toEqual({p_actor: ACTOR, p_account_id: ACCOUNT});
    });

    it.each([['already_enabled', 5], ['not_found', null]] as const)('maps %s', async (outcome, epoch) => {
      const {fetch} = endpoint(() => ({body: {outcome, epoch}}));
      expect(await enableAccount({accountId: ACCOUNT, actor: ACTOR}, {env: environment(), fetch})).toEqual({outcome, epoch});
    });

    it.each([
      ['an outcome it does not know', {outcome: 'on'}],
      ['an enable that does not name the epoch', {outcome: 'enabled', epoch: null}],
      ['an epoch that is not a number', {outcome: 'already_enabled', epoch: 'five'}],
      ['no outcome', {}],
    ])('treats %s as no answer at all', async (_name, body) => {
      await expect(enableAccount({accountId: ACCOUNT, actor: ACTOR}, {env: environment(), fetch: endpoint(() => ({body})).fetch})).rejects.toBeInstanceOf(AccountsUnavailableError);
    });

    it('refuses a bad Account ID or actor without calling the database', async () => {
      const {calls, fetch} = endpoint(() => ({body: {outcome: 'enabled', epoch: 2}}));
      await expect(enableAccount({accountId: 'nope', actor: ACTOR}, {env: environment(), fetch})).rejects.toThrow(TypeError);
      await expect(enableAccount({accountId: ACCOUNT, actor: 'nobody knows'}, {env: environment(), fetch})).rejects.toThrow(TypeError);
      expect(calls).toHaveLength(0);
    });
  });

  describe('guardOperation', () => {
    it('names the five answers the database gives, and no others', () => {
      expect([...operationOutcomes]).toEqual(['allowed', 'disabled', 'stale_epoch', 'no_account', 'tombstoned']);
    });

    it('sends the Account and the epoch it registered under to api.guard_operation', async () => {
      const {calls, fetch} = endpoint(() => ({body: {outcome: 'allowed', epoch: 3}}));
      expect(await guardOperation({accountId: ACCOUNT.toUpperCase(), epoch: 3}, {env: environment(), fetch})).toEqual({outcome: 'allowed', epoch: 3});
      expect(calls[0].url).toBe('http://127.0.0.1:54321/rest/v1/rpc/guard_operation');
      expect(calls[0].body).toEqual({p_account_id: ACCOUNT, p_epoch: 3});
    });

    // `tombstoned` (Story 1.8) is a deleted Account: its row may be gone, and then there is no epoch to report.
    it.each([['disabled', 4], ['stale_epoch', 4], ['no_account', null], ['tombstoned', 4], ['tombstoned', null]] as const)('maps %s (epoch %s)', async (outcome, epoch) => {
      const {fetch} = endpoint(() => ({body: {outcome, epoch}}));
      expect(await guardOperation({accountId: ACCOUNT, epoch: 3}, {env: environment(), fetch})).toEqual({outcome, epoch});
    });

    it.each([
      ['an outcome it does not know', {outcome: 'ok', epoch: 1}],
      ['an answer for a known Account that names no epoch', {outcome: 'allowed', epoch: null}],
      ['a stale answer without an epoch', {outcome: 'stale_epoch'}],
      ['text', 'allowed'],
    ])('treats %s as no answer at all, which is never permission', async (_name, body) => {
      await expect(guardOperation({accountId: ACCOUNT, epoch: 3}, {env: environment(), fetch: endpoint(() => ({body})).fetch})).rejects.toBeInstanceOf(AccountsUnavailableError);
    });

    it('refuses an Account ID that is not a UUID and an epoch that is not a positive integer, without calling the database', async () => {
      const {calls, fetch} = endpoint(() => ({body: {outcome: 'allowed', epoch: 1}}));
      await expect(guardOperation({accountId: 'nope', epoch: 3}, {env: environment(), fetch})).rejects.toThrow(TypeError);
      for (const epoch of [0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, 2 ** 60, '3' as never, null as never, undefined as never]) {
        await expect(guardOperation({accountId: ACCOUNT, epoch}, {env: environment(), fetch}), String(epoch)).rejects.toThrow(TypeError);
      }
      expect(calls).toHaveLength(0);
    });
  });

  describe('recordAccountRefusal', () => {
    it('names the three refusals the database records, and no others', () => {
      expect([...accountRefusalActions]).toEqual(['account.disable_refused', 'account.enable_refused', 'account.denied']);
    });

    it('sends the verified Auth user, the action and the Account to api.record_account_refusal, and nothing else', async () => {
      const {calls, fetch} = endpoint(() => ({body: {outcome: 'recorded'}}));
      expect(await recordAccountRefusal({userId: USER.toUpperCase(), action: 'account.disable_refused', accountId: ACCOUNT.toUpperCase()}, {env: environment(), fetch})).toBe('recorded');
      expect(calls[0].url).toBe('http://127.0.0.1:54321/rest/v1/rpc/record_account_refusal');
      expect(calls[0].body).toEqual({p_user_id: USER, p_action: 'account.disable_refused', p_account_id: ACCOUNT});
      expect(await recordAccountRefusal({userId: USER, action: 'account.denied'}, {env: environment(), fetch})).toBe('recorded');
      expect(calls[1].body).toEqual({p_user_id: USER, p_action: 'account.denied', p_account_id: null});
      // Extra fields in the input go nowhere: the typed call builds the body from the three it knows.
      await recordAccountRefusal({userId: USER, action: 'account.enable_refused', email: 'dana@example.com', reason: 'expired'} as never, {env: environment(), fetch});
      expect(JSON.stringify(calls[2].body)).not.toMatch(/dana|expired/);
      expect(Object.keys(calls[2].body).sort()).toEqual(['p_account_id', 'p_action', 'p_user_id']);
    });

    it.each(['recorded', 'repeated'] as const)('maps the %s outcome', async (outcome) => {
      const {fetch} = endpoint(() => ({body: {outcome}}));
      expect(await recordAccountRefusal({userId: USER, action: 'account.denied'}, {env: environment(), fetch})).toBe(outcome);
    });

    it.each([['an outcome it does not know', {outcome: 'ok'}], ['no outcome', {}], ['text', 'recorded']])('treats %s as no answer at all', async (_name, body) => {
      await expect(recordAccountRefusal({userId: USER, action: 'account.denied'}, {env: environment(), fetch: endpoint(() => ({body})).fetch})).rejects.toBeInstanceOf(AccountsUnavailableError);
    });

    it('refuses an action it does not know, and an ID that is not a UUID, without calling the database', async () => {
      const {calls, fetch} = endpoint(() => ({body: {outcome: 'recorded'}}));
      for (const action of ['account.disabled', 'account.enabled', 'invitation.denied', 'account.refused', '', undefined, 7]) {
        await expect(recordAccountRefusal({userId: USER, action: action as never}, {env: environment(), fetch}), String(action)).rejects.toThrow(TypeError);
      }
      await expect(recordAccountRefusal({userId: 'nope', action: 'account.denied'}, {env: environment(), fetch})).rejects.toThrow(TypeError);
      await expect(recordAccountRefusal({userId: USER, action: 'account.disable_refused', accountId: "x'; drop table"}, {env: environment(), fetch})).rejects.toThrow(TypeError);
      expect(calls).toHaveLength(0);
    });
  });
});


// ---------------------------------------------------------------------------------------------------
describe('Administrator recovery (Story 1.6)', () => {
  const ADMIN_ADDRESS = 'Administrator@Example.Test';
  const SESSION = '3b1c9a3e-6a3e-4f19-9d0e-0a4f5e2c8d11';
  const recoveryKeyText = keyText();
  const recoveryEnvironment = (): Env => ({...environment(), RECOVERY_HASH_KEY: recoveryKeyText, ADMINISTRATOR_EMAIL: ADMIN_ADDRESS});
  const hashOf = (token: string) => hashRecoveryToken(token, Buffer.from(recoveryKeyText, 'base64'));
  const issuedRow = {outcome: 'issued', expires_at: '2026-10-12T15:15:00.123456+00:00'};

  describe('hashRecoveryToken', () => {
    const recoveryKey = Buffer.from(recoveryKeyText, 'base64');

    it('is the hex HMAC-SHA-256 of the token under the key, with a domain of its own', () => {
      const token = newRecoveryToken();
      const expected = createHmac('sha256', recoveryKey).update(`nova3d/recovery-token/v1\0${token}`).digest('hex');
      expect(hashRecoveryToken(token, recoveryKey)).toBe(expected);
      expect(expected).toMatch(/^[0-9a-f]{64}$/);
      // The same text hashed as an invitation code, or under another key, is another value: a hash is good for one purpose.
      expect(hashInvitationCode(token, recoveryKey)).not.toBe(expected);
      expect(hashRecoveryToken(token, key())).not.toBe(expected);
    });

    it('is bounded: only the first 256 characters count, and anything that is not text is the empty token', () => {
      expect(hashRecoveryToken('a'.repeat(300), recoveryKey)).toBe(hashRecoveryToken('a'.repeat(256), recoveryKey));
      for (const value of [undefined, null, 42, {}, ['x']]) expect(hashRecoveryToken(value, recoveryKey)).toBe(hashRecoveryToken('', recoveryKey));
    });
  });

  describe('issueRecovery', () => {
    it('makes the token here, sends only its keyed hash and the configured address, and returns the token for the one mailed link', async () => {
      const {calls, fetch} = endpoint(() => ({body: issuedRow}));
      const issued = await issueRecovery({env: recoveryEnvironment(), fetch});
      expect(issued.outcome).toBe('issued');
      if (issued.outcome !== 'issued') throw new Error('unreachable');
      expect(isRecoveryToken(issued.token)).toBe(true);
      expect(issued.expiresAt).toBe('2026-10-12T15:15:00.123456+00:00');
      expect(calls).toHaveLength(1);
      expect(calls[0].url).toBe('http://127.0.0.1:54321/rest/v1/rpc/issue_recovery');
      // Two arguments, no more: the database never sees the token, and the address is the environment's, lower case.
      expect(calls[0].body).toEqual({p_token_hash: hashOf(issued.token), p_administrator_email: 'administrator@example.test'});
      expect(JSON.stringify(calls[0].body)).not.toContain(issued.token);
      expect(JSON.stringify(calls[0].body)).not.toContain(SERVICE_KEY);
      expect(calls[0].init.headers).toMatchObject({'content-profile': 'api', authorization: `Bearer ${SERVICE_KEY}`});
    });

    it('takes no address: the caller cannot choose one, because the function has no parameter for it', () => {
      expect(issueRecovery.length).toBeLessThanOrEqual(1);
    });

    it('makes a different token every time', async () => {
      const tokens = new Set<string>();
      for (let index = 0; index < 20; index += 1) {
        const issued = await issueRecovery({env: recoveryEnvironment(), fetch: endpoint(() => ({body: issuedRow})).fetch});
        if (issued.outcome === 'issued') tokens.add(issued.token);
      }
      expect(tokens.size).toBe(20);
    });

    it.each(['limited', 'refused'] as const)('says %s, with no token: nothing was issued, so nothing is returned that could be mailed', async (outcome) => {
      const {calls, fetch} = endpoint(() => ({body: {outcome, expires_at: null}}));
      const answer = await issueRecovery({env: recoveryEnvironment(), fetch});
      expect(answer).toEqual({outcome});
      expect(calls).toHaveLength(1);
    });

    it.each([
      ['an outcome it does not know', {outcome: 'sent'}],
      ['an issuance that does not say when it expires', {outcome: 'issued', expires_at: null}],
      ['text', 'issued'],
      ['a list', []],
    ])('treats %s as no answer at all', async (_name, body) => {
      await expect(issueRecovery({env: recoveryEnvironment(), fetch: endpoint(() => ({body})).fetch})).rejects.toBeInstanceOf(AccountsUnavailableError);
    });

    it('fails with a name of the setting, never a value, when it is not configured', async () => {
      const {calls, fetch} = endpoint(() => ({body: issuedRow}));
      const cases: [Env, RegExp][] = [
        [{...recoveryEnvironment(), RECOVERY_HASH_KEY: undefined}, /RECOVERY_HASH_KEY is not set/],
        [{...recoveryEnvironment(), RECOVERY_HASH_KEY: 'short'}, /RECOVERY_HASH_KEY must decode to at least 32 bytes/],
        [{...recoveryEnvironment(), RECOVERY_HASH_KEY: '<staging-recovery-hash-key>'}, /RECOVERY_HASH_KEY is a placeholder/],
        [{...recoveryEnvironment(), ADMINISTRATOR_EMAIL: undefined}, /ADMINISTRATOR_EMAIL is not set/],
        [{...recoveryEnvironment(), ADMINISTRATOR_EMAIL: '<administrator-email>'}, /ADMINISTRATOR_EMAIL is not set/],
        [{...recoveryEnvironment(), ADMINISTRATOR_EMAIL: 'not-an-address'}, /ADMINISTRATOR_EMAIL is not an email address/],
        [{...recoveryEnvironment(), ADMINISTRATOR_EMAIL: 'a@example.test, b@example.test'}, /ADMINISTRATOR_EMAIL is not an email address/],
      ];
      for (const [env, message] of cases) {
        const thrown = await issueRecovery({env, fetch}).catch((error: Error) => error);
        expect(thrown).toBeInstanceOf(AccountsConfigError);
        expect((thrown as Error).message).toMatch(message);
      }
      expect(calls).toHaveLength(0);
    });

    it('says, when it throws, that the token may have been stored and nobody holds it', async () => {
      await expect(issueRecovery({env: recoveryEnvironment(), fetch: async () => { throw new TypeError('fetch failed'); }})).rejects.toMatchObject({retryable: true, outcomeUnknown: true});
      await expect(issueRecovery({env: recoveryEnvironment(), fetch: endpoint(() => ({status: 400, body: {code: '22023'}})).fetch})).rejects.toMatchObject({retryable: false, outcomeUnknown: false, code: '22023'});
    });
  });

  describe('voidRecovery', () => {
    it('sends the token\'s keyed hash and whether the refusal was definitive, and maps the outcome', async () => {
      const token = newRecoveryToken();
      for (const outcome of ['voided', 'recorded', 'not_found'] as const) {
        const {calls, fetch} = endpoint(() => ({body: {outcome}}));
        expect(await voidRecovery({token, definitive: true}, {env: recoveryEnvironment(), fetch})).toBe(outcome);
        expect(calls[0].url).toBe('http://127.0.0.1:54321/rest/v1/rpc/void_recovery');
        expect(calls[0].body).toEqual({p_token_hash: hashOf(token), p_definitive: true});
        expect(JSON.stringify(calls[0].body)).not.toContain(token);
      }
    });

    it('is definitive only when it is exactly true', async () => {
      for (const value of [false, undefined, null, 'true', 1] as unknown[]) {
        const {calls, fetch} = endpoint(() => ({body: {outcome: 'recorded'}}));
        await voidRecovery({token: newRecoveryToken(), definitive: value as boolean}, {env: recoveryEnvironment(), fetch});
        expect(calls[0].body.p_definitive, String(value)).toBe(false);
      }
    });

    it('treats an outcome it does not know as no answer', async () => {
      await expect(voidRecovery({token: newRecoveryToken(), definitive: true}, {env: recoveryEnvironment(), fetch: endpoint(() => ({body: {outcome: 'gone'}})).fetch})).rejects.toBeInstanceOf(AccountsUnavailableError);
    });
  });

  describe('checkRecovery', () => {
    const valid = {outcome: 'valid', user_id: USER.toUpperCase(), email: 'administrator@example.test'};

    it('sends the token\'s keyed hash and the configured address, and says for which Auth user the token is valid', async () => {
      const token = newRecoveryToken();
      const {calls, fetch} = endpoint(() => ({body: valid}));
      expect(await checkRecovery({token}, {env: recoveryEnvironment(), fetch})).toEqual({outcome: 'valid', userId: USER, email: 'administrator@example.test'});
      expect(calls[0].url).toBe('http://127.0.0.1:54321/rest/v1/rpc/check_recovery');
      expect(calls[0].body).toEqual({p_token_hash: hashOf(token), p_administrator_email: 'administrator@example.test'});
      expect(JSON.stringify(calls[0].body)).not.toContain(token);
    });

    it.each(recoveryRefusals)('says %s, with no user and no address', async (outcome) => {
      const {fetch} = endpoint(() => ({body: {outcome, user_id: null, email: null}}));
      expect(await checkRecovery({token: newRecoveryToken()}, {env: recoveryEnvironment(), fetch})).toEqual({outcome});
    });

    it('hashes whatever the request carried, cut to a bounded length, and never throws for it', async () => {
      for (const token of ['', 'short', 'x'.repeat(5000), '<script>', 'é'.repeat(43), undefined as unknown as string, 42 as unknown as string]) {
        const {calls, fetch} = endpoint(() => ({body: {outcome: 'unknown', user_id: null, email: null}}));
        expect(await checkRecovery({token}, {env: recoveryEnvironment(), fetch})).toEqual({outcome: 'unknown'});
        expect(calls[0].body.p_token_hash).toBe(hashRecoveryToken(token, Buffer.from(recoveryKeyText, 'base64')));
        expect(calls[0].body.p_token_hash).toMatch(/^[0-9a-f]{64}$/);
      }
    });

    it.each([
      ['an outcome it does not know', {outcome: 'maybe'}],
      ['a valid token for nobody', {...valid, user_id: null}],
      ['a valid token for a user that is not a UUID', {...valid, user_id: 'admin'}],
      ['a valid token with no address', {...valid, email: null}],
      ['text', 'valid'],
    ])('treats %s as no answer at all', async (_name, body) => {
      await expect(checkRecovery({token: newRecoveryToken()}, {env: recoveryEnvironment(), fetch: endpoint(() => ({body})).fetch})).rejects.toBeInstanceOf(AccountsUnavailableError);
    });

    it('fails closed when the database cannot be reached', async () => {
      await expect(checkRecovery({token: newRecoveryToken()}, {env: recoveryEnvironment(), fetch: async () => { throw new TypeError('fetch failed'); }})).rejects.toMatchObject({retryable: true});
    });
  });

  describe('redeemRecoveryToken', () => {
    const done = {outcome: 'redeemed', sessions_ended: 2, epoch: 5};

    it('sends the token\'s keyed hash, the configured address, the user and the session, and maps the receipt', async () => {
      const token = newRecoveryToken();
      const {calls, fetch} = endpoint(() => ({body: done}));
      expect(await redeemRecoveryToken({token, userId: USER.toUpperCase(), sessionId: SESSION.toUpperCase()}, {env: recoveryEnvironment(), fetch})).toEqual({outcome: 'redeemed', sessionsEnded: 2, epoch: 5});
      expect(calls).toHaveLength(1);
      expect(calls[0].url).toBe('http://127.0.0.1:54321/rest/v1/rpc/redeem_recovery');
      expect(calls[0].body).toEqual({p_token_hash: hashOf(token), p_administrator_email: 'administrator@example.test', p_user_id: USER, p_session_id: SESSION});
      expect(JSON.stringify(calls[0].body)).not.toContain(token);
    });

    it.each(recoveryRefusals)('maps %s, with no counts', async (outcome) => {
      const {fetch} = endpoint(() => ({body: {outcome, sessions_ended: null, epoch: null}}));
      expect(await redeemRecoveryToken({token: newRecoveryToken(), userId: USER, sessionId: SESSION}, {env: recoveryEnvironment(), fetch})).toEqual({outcome});
    });

    it('refuses a user or a session that is not a UUID, without calling the database', async () => {
      const {calls, fetch} = endpoint(() => ({body: done}));
      const token = newRecoveryToken();
      await expect(redeemRecoveryToken({token, userId: 'someone', sessionId: SESSION}, {env: recoveryEnvironment(), fetch})).rejects.toThrow(TypeError);
      await expect(redeemRecoveryToken({token, userId: USER, sessionId: "x'; drop table"}, {env: recoveryEnvironment(), fetch})).rejects.toThrow(TypeError);
      expect(calls).toHaveLength(0);
    });

    it.each([
      ['an outcome it does not know', {outcome: 'done'}],
      ['a redemption that does not say what it ended', {...done, sessions_ended: null}],
      ['a redemption that does not name the epoch', {...done, epoch: undefined}],
      ['a negative count', {...done, sessions_ended: -1}],
      ['a count that is not a number', {...done, sessions_ended: 'two'}],
      ['text', 'redeemed'],
    ])('treats %s as no answer at all', async (_name, body) => {
      await expect(redeemRecoveryToken({token: newRecoveryToken(), userId: USER, sessionId: SESSION}, {env: recoveryEnvironment(), fetch: endpoint(() => ({body})).fetch})).rejects.toBeInstanceOf(AccountsUnavailableError);
    });

    it('says, when it throws, whether the transaction may have committed', async () => {
      const input = {token: newRecoveryToken(), userId: USER, sessionId: SESSION};
      await expect(redeemRecoveryToken(input, {env: recoveryEnvironment(), fetch: async () => { throw new TypeError('fetch failed'); }})).rejects.toMatchObject({retryable: true, outcomeUnknown: true});
      await expect(redeemRecoveryToken(input, {env: recoveryEnvironment(), fetch: endpoint(() => ({status: 503, body: {}})).fetch})).rejects.toMatchObject({retryable: true, outcomeUnknown: true});
      await expect(redeemRecoveryToken(input, {env: recoveryEnvironment(), fetch: endpoint(() => ({status: 400, body: {code: '22023'}})).fetch})).rejects.toMatchObject({retryable: false, outcomeUnknown: false, code: '22023'});
    });
  });

  it('keeps every database function behind its typed call: nothing else names them', () => {
    const files = ['app', 'components', 'lib', 'scripts', 'proxy.ts'].flatMap((entry) => {
      const path = join(root, entry);
      return statSync(path).isDirectory() ? readdirSyncRecursive(path) : [path];
    });
    for (const file of files) {
      const name = relative(root, file);
      if (name === 'lib/accounts.ts') continue;
      const code = readFileSync(file, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
      expect(code, name).not.toMatch(/\b(?:issue|void|check|redeem)_recovery\b|recovery_tokens/);
    }
  });
});

function readdirSyncRecursive(directory: string): string[] {
  return readdirSync(directory).flatMap((name) => {
    const path = join(directory, name);
    if (name === 'node_modules' || name === '.next') return [];
    if (statSync(path).isDirectory()) return readdirSyncRecursive(path);
    return /\.(?:ts|tsx|mjs|js|jsx)$/.test(name) ? [path] : [];
  });
}

// ---------------------------------------------------------------------------------------------------
describe('server-only boundary', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.resetModules();
  });

  it('refuses to load where a window exists', async () => {
    vi.resetModules();
    vi.stubGlobal('window', {});
    await expect(import('@/lib/accounts')).rejects.toThrow('server-only');
  });

  const skipped = new Set(['node_modules', '.next', '.git', 'playwright-report', 'test-results']);
  function sourceFiles(directory: string): string[] {
    return readdirSync(directory).flatMap((name) => {
      const path = join(directory, name);
      if (skipped.has(name)) return [];
      if (statSync(path).isDirectory()) return sourceFiles(path);
      return /\.(?:ts|tsx|mjs|js|jsx)$/.test(name) ? [path] : [];
    });
  }

  /** Every module specifier a source file imports (static, dynamic or re-exported), resolved to a path without extension. */
  function importedModules(file: string, source: string) {
    const specifiers = [...source.matchAll(/(?:\bfrom|\bimport)\s*\(?\s*['"]([^'"]+)['"]/g)].map((match) => match[1]);
    return specifiers
      .map((specifier) => (specifier.startsWith('@/') ? join(root, specifier.slice(2)) : specifier.startsWith('.') ? resolve(dirname(file), specifier) : specifier))
      .map((path) => path.replace(/\.(?:ts|tsx|mjs|js)$/, ''));
  }
  // Server-only modules: the accounts library, and the access decision that is built on it. (lib/register.ts is
  // the opposite by design: the types and constants the registration form shares with its Server Action, free
  // of server imports, so the client component may use it. Its own test below keeps it that way.)
  const serverOnly = [join(root, 'lib/accounts'), join(root, 'lib/access')];
  const importsServerOnly = (file: string, source: string) => importedModules(file, source).some((module) => serverOnly.includes(module));
  const importsAccounts = (file: string, source: string) => importedModules(file, source).includes(serverOnly[0]);
  const isClientFile = (source: string) => /^\s*(?:\/\*[\s\S]*?\*\/\s*|\/\/.*\n\s*)*['"]use client['"]/.test(source);

  it('recognizes an import of lib/accounts however it is spelled, and a client file by its directive', () => {
    const lib = join(root, 'lib/other.ts');
    expect(importsAccounts(join(root, 'components/a.tsx'), "import {x} from '@/lib/accounts';")).toBe(true);
    expect(importsAccounts(join(root, 'components/a.tsx'), 'import {x} from "../lib/accounts.ts"')).toBe(true);
    expect(importsAccounts(lib, "import {x} from './accounts'")).toBe(true);
    expect(importsAccounts(lib, "export {x} from './accounts.ts'")).toBe(true);
    expect(importsAccounts(join(root, 'app/a.tsx'), "const m = await import('@/lib/accounts')")).toBe(true);
    expect(importsAccounts(join(root, 'components/a.tsx'), "import {x} from '@/lib/accounts-other'")).toBe(false);
    expect(importsServerOnly(join(root, 'components/a.tsx'), "import {x} from '@/lib/access'")).toBe(true);
    expect(importsServerOnly(lib, "import {x} from './access.ts'")).toBe(true);
    expect(importsServerOnly(join(root, 'components/a.tsx'), "import {x} from '@/lib/register'")).toBe(false);
    expect(importsServerOnly(join(root, 'components/a.tsx'), "import {x} from '@/lib/access-other'")).toBe(false);
    expect(importsAccounts(join(root, 'components/a.tsx'), "import {x} from './accounts'")).toBe(false);
    expect(isClientFile("'use client';\nimport x from 'y';")).toBe(true);
    expect(isClientFile('"use client"\n')).toBe(true);
    expect(isClientFile("// header\n'use client';\n")).toBe(true);
    expect(isClientFile("import x from 'y';\n'use client';\n")).toBe(false);
    expect(isClientFile('export const note = "use client";')).toBe(false);
  });

  it('is imported by no client component and nothing under components/', () => {
    const files = ['app', 'components', 'lib'].flatMap((directory) => sourceFiles(join(root, directory)));
    expect(files.length).toBeGreaterThan(20);
    const importers: string[] = [];
    for (const file of files) {
      const source = readFileSync(file, 'utf8');
      if (!importsServerOnly(file, source)) continue;
      const name = relative(root, file);
      importers.push(name);
      expect(name.startsWith('components/'), `${name} is under components/`).toBe(false);
      expect(isClientFile(source), `${name} is a client component`).toBe(false);
    }
    // Server code does import them: the guard is about where, not about whether.
    expect(importers).toEqual(expect.arrayContaining(['lib/auth.ts', 'app/auth/callback/route.ts', 'app/register/actions.ts']));
  });

  it('keeps lib/register.ts free of server-only imports, because the registration form is a client component that uses it', () => {
    const file = join(root, 'lib/register.ts');
    const source = readFileSync(file, 'utf8');
    const imported = importedModules(file, source);
    expect(imported.filter((module) => serverOnly.includes(module))).toEqual([]);
    expect(imported.filter((module) => /^(?:node:|next\/(?:headers|server))/.test(module))).toEqual([]);
    expect(imported.every((module) => module === join(root, 'lib/i18n'))).toBe(true);
    expect(readFileSync(join(root, 'components/register-form.tsx'), 'utf8')).toContain("from '@/lib/register'");
  });
});
