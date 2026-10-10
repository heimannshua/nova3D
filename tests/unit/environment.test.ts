import {randomBytes} from 'node:crypto';
import {describe, expect, it} from 'vitest';
import {checkAccountsApi, checkInstanceIdentity, compareIdentity, nilUserId, decodeHashKey, fetchInstanceIdentity, hashKeyProblem, identityMismatchHint, isLoopbackUrl, parseEmailList, parseEnvValue, sameKey, validateEnvironment, verifyInstanceIdentity, type Env, type IdentityFetch} from '@/lib/environment';

const INSTANCE = '3f0d6c1e-8a52-4c1b-9d57-2b6a1f0e7c44';
const SERVICE_KEY = 'fixture-service-key-must-never-be-returned';

// Both hashing keys are required outside a preview (Story 1.3 Part B), so a complete environment holds them.
const hashKeys = (): Env => ({INVITATION_HASH_KEY: randomBytes(32).toString('base64'), RATE_LIMIT_HASH_KEY: randomBytes(32).toString('base64')});

const staging: Env = {
  APP_ENV: 'staging',
  NEXT_PUBLIC_APP_ENV: 'staging',
  NEXT_PUBLIC_SUPABASE_URL: 'https://abcdefgh.supabase.co',
  NEXT_PUBLIC_SUPABASE_ANON_KEY: 'anon',
  SUPABASE_SERVICE_ROLE_KEY: SERVICE_KEY,
  ADMINISTRATOR_EMAIL: 'admin@example.com',
  INSTANCE_ID: INSTANCE,
  PAID_ADAPTERS_ENABLED: 'false',
  SYNTHETIC_DATA_ENABLED: 'true',
  VERCEL: '1',
  VERCEL_ENV: 'production',
  ...hashKeys(),
};

const noKeys: Env = {INVITATION_HASH_KEY: undefined, RATE_LIMIT_HASH_KEY: undefined};
const answer = (status: number, body: unknown): IdentityFetch => async () => new Response(JSON.stringify(body), {status});

describe('isLoopbackUrl', () => {
  it.each(['http://127.0.0.1:54321', 'http://localhost:54321', 'http://[::1]:54321', 'https://127.0.0.2', 'http://127.1'])('accepts %s', (url) => {
    expect(isLoopbackUrl(url)).toBe(true);
  });
  it.each(['https://abcdefgh.supabase.co', 'http://127.0.0.1.nip.io', 'http://localhost.evil.test', 'http://127.0.0.1@evil.test', 'ftp://127.0.0.1', 'not a url', ''])('rejects %s', (url) => {
    expect(isLoopbackUrl(url)).toBe(false);
  });
});

describe('validateEnvironment', () => {
  it('accepts a complete staging deployment', () => {
    expect(validateEnvironment(staging)).toEqual([]);
  });

  it('requires ADMINISTRATOR_EMAIL and INSTANCE_ID everywhere, previews included', () => {
    const preview = {...staging, VERCEL_ENV: 'preview', NEXT_PUBLIC_SUPABASE_URL: undefined, NEXT_PUBLIC_SUPABASE_ANON_KEY: undefined, SUPABASE_SERVICE_ROLE_KEY: undefined, ...noKeys};
    expect(validateEnvironment(preview)).toEqual([]);
    expect(validateEnvironment({...preview, ADMINISTRATOR_EMAIL: undefined}).join()).toContain('ADMINISTRATOR_EMAIL');
    expect(validateEnvironment({...preview, INSTANCE_ID: undefined}).join()).toContain('INSTANCE_ID');
  });

  it('lists the offending variable names for a preview, never their values', () => {
    const errors = validateEnvironment({...staging, VERCEL_ENV: 'preview'});
    expect(errors.join()).toContain('NEXT_PUBLIC_SUPABASE_ANON_KEY');
    expect(errors.join()).toContain('SUPABASE_SERVICE_ROLE_KEY');
    expect(errors.join()).not.toContain(SERVICE_KEY);
  });

  it('rejects local against a hosted URL but not staging against a loopback https URL', () => {
    expect(validateEnvironment({...staging, APP_ENV: 'local', NEXT_PUBLIC_APP_ENV: 'local', VERCEL: undefined, VERCEL_ENV: undefined}).join()).toContain('loopback');
    expect(validateEnvironment({...staging, NEXT_PUBLIC_SUPABASE_URL: 'https://127.0.0.1:54321'})).toEqual([]);
  });

  it('requires https for staging and production, not for local', () => {
    const http = 'http://abcdefgh.supabase.co';
    expect(validateEnvironment({...staging, NEXT_PUBLIC_SUPABASE_URL: http}).join()).toContain('must use https');
    const production = {...staging, APP_ENV: 'production', NEXT_PUBLIC_APP_ENV: 'production', SYNTHETIC_DATA_ENABLED: 'false', PAID_ADAPTERS_ENABLED: 'true'};
    expect(validateEnvironment(production)).toEqual([]);
    expect(validateEnvironment({...production, NEXT_PUBLIC_SUPABASE_URL: http}).join()).toContain('must use https');
    const local = {...staging, APP_ENV: 'local', NEXT_PUBLIC_APP_ENV: 'local', VERCEL: undefined, VERCEL_ENV: undefined, NEXT_PUBLIC_SUPABASE_URL: 'http://127.0.0.1:54321'};
    expect(validateEnvironment(local)).toEqual([]);
  });

  describe('previews', () => {
    const preview: Env = {
      APP_ENV: 'staging',
      NEXT_PUBLIC_APP_ENV: 'staging',
      ADMINISTRATOR_EMAIL: 'admin@example.com',
      INSTANCE_ID: INSTANCE,
      PAID_ADAPTERS_ENABLED: 'false',
      SYNTHETIC_DATA_ENABLED: 'true',
      VERCEL: '1',
      VERCEL_ENV: 'preview',
    };

    it('accept a label-only environment', () => {
      expect(validateEnvironment(preview)).toEqual([]);
    });

    it.each([
      'SUPABASE_URL',
      'SUPABASE_ANON_KEY',
      'SUPABASE_JWT_SECRET',
      'NEXT_PUBLIC_SUPABASE_URL',
      'NEXT_PUBLIC_SUPABASE_ANON_KEY',
      'SUPABASE_SERVICE_ROLE_KEY',
      'DATABASE_URL',
      'POSTGRES_URL',
      'POSTGRES_PASSWORD',
      'STRIPE_SECRET_KEY',
      'STRIPE_WEBHOOK_SECRET',
      'NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY',
    ])('reject %s, naming the variable and never its value', (name) => {
      const value = `value-for-${name.toLowerCase()}-must-never-be-printed`;
      for (const vercelEnv of ['preview', 'development']) {
        const errors = validateEnvironment({...preview, VERCEL_ENV: vercelEnv, [name]: value});
        expect(errors.join(), name).toContain(name);
        expect(errors.join(), name).not.toContain(value);
      }
    });

    it('ignore variables that only look similar, and empty ones', () => {
      expect(validateEnvironment({...preview, MY_SUPABASE_NOTE: 'x', DATABASE_URL_NOTE: 'x', STRIPE: 'x', SUPABASE_URL: ''})).toEqual([]);
    });

    it('do not apply to a production deployment', () => {
      expect(validateEnvironment({...staging, DATABASE_URL: 'postgres://example', STRIPE_SECRET_KEY: 'sk_test'})).toEqual([]);
    });
  });

  describe('placeholders', () => {
    it.each(['replace-with-the-real-one', '<administrator-email>', 'changeme', 'TODO', 'todo'])('rejects %s', (value) => {
      expect(validateEnvironment({...staging, ADMINISTRATOR_EMAIL: value, INSTANCE_ID: value}).join()).toContain('placeholder values are not allowed');
    });

    it('does not mistake a real address that starts with a placeholder word', () => {
      for (const email of ['todos@example.com', 'todo.list@example.com', 'changemefast@example.com']) {
        expect(validateEnvironment({...staging, ADMINISTRATOR_EMAIL: email}), email).toEqual([]);
      }
    });
  });
});

describe('compareIdentity', () => {
  it('accepts a matching row regardless of UUID case or padding', () => {
    expect(compareIdentity(staging, {environment: 'staging', instance_id: INSTANCE.toUpperCase()})).toEqual([]);
    expect(compareIdentity({...staging, INSTANCE_ID: ` ${INSTANCE} `}, {environment: 'staging', instance_id: INSTANCE})).toEqual([]);
  });

  it('names each mismatch and prints no UUID', () => {
    const errors = compareIdentity(staging, {environment: 'production', instance_id: '9a1b2c3d-4e5f-4a6b-8c7d-0e1f2a3b4c5d'});
    expect(errors).toHaveLength(2);
    expect(errors[0]).toContain('environment mismatch');
    expect(errors[1]).toContain('instance mismatch');
    expect(errors.join()).not.toContain(INSTANCE);
    expect(errors.join()).not.toContain('9a1b2c3d');
  });
});

describe('verifyInstanceIdentity', () => {
  it('passes when the row matches', async () => {
    const seen: {url: string; init?: RequestInit}[] = [];
    const spy: IdentityFetch = async (url, init) => {
      seen.push({url, init});
      return new Response(JSON.stringify([{environment: 'staging', instance_id: INSTANCE}]), {status: 200});
    };
    expect(await verifyInstanceIdentity(staging, spy)).toEqual([]);
    expect(seen).toHaveLength(1);
    expect(seen[0].url).toBe('https://abcdefgh.supabase.co/rest/v1/instance_identity?select=environment,instance_id');
    expect((seen[0].init?.headers as Record<string, string>)['accept-profile']).toBe('lifecycle');
  });

  it('fails closed when the database is unreachable', async () => {
    const errors = await verifyInstanceIdentity(staging, async () => { throw new TypeError('fetch failed'); });
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain('unreachable');
  });

  it.each([
    ['no row', answer(200, []), 'no row'],
    ['two rows', answer(200, [{environment: 'staging', instance_id: INSTANCE}, {environment: 'staging', instance_id: INSTANCE}]), 'more than one row'],
    ['a malformed row', answer(200, [{environment: 7}]), 'malformed'],
    ['a non-array body', answer(200, {message: 'hi'}), 'no row'],
    ['an HTTP error', answer(401, {message: 'denied'}), 'HTTP 401'],
    ['a missing schema', answer(406, {code: 'PGRST106'}), 'HTTP 406'],
  ])('fails closed on %s', async (_name, fetchImpl, text) => {
    const errors = await verifyInstanceIdentity(staging, fetchImpl);
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain(text);
    expect(errors[0]).not.toContain(SERVICE_KEY);
  });

  it('fails closed on a non-JSON body', async () => {
    const errors = await verifyInstanceIdentity(staging, async () => new Response('<html>', {status: 200}));
    expect(errors[0]).toContain('not JSON');
  });

  it('never reads the database for a preview', async () => {
    let calls = 0;
    const preview = {...staging, VERCEL_ENV: 'preview', NEXT_PUBLIC_SUPABASE_URL: undefined, NEXT_PUBLIC_SUPABASE_ANON_KEY: undefined, SUPABASE_SERVICE_ROLE_KEY: undefined, ...noKeys};
    const errors = await verifyInstanceIdentity(preview, async () => { calls += 1; return new Response('[]'); });
    expect(errors).toEqual([]);
    expect(calls).toBe(0);
  });

  it('does not contact the database when the labels are already invalid', async () => {
    let calls = 0;
    const errors = await verifyInstanceIdentity({...staging, ADMINISTRATOR_EMAIL: ''}, async () => { calls += 1; return new Response('[]'); });
    expect(errors.join()).toContain('ADMINISTRATOR_EMAIL');
    expect(calls).toBe(0);
  });
});

describe('fetchInstanceIdentity', () => {
  const row = JSON.stringify([{environment: 'staging', instance_id: INSTANCE}]);

  it('needs both a URL and a key', async () => {
    expect((await fetchInstanceIdentity({})).error).toContain('missing');
  });

  it('refuses redirects and trims the key before sending it', async () => {
    let seen: RequestInit | undefined;
    const spy: IdentityFetch = async (_url, init) => {
      seen = init;
      return new Response(row);
    };
    const {identity} = await fetchInstanceIdentity({...staging, SUPABASE_SERVICE_ROLE_KEY: `  ${SERVICE_KEY}\n`, NEXT_PUBLIC_SUPABASE_URL: ' https://abcdefgh.supabase.co '}, spy);
    expect(identity).toEqual({environment: 'staging', instance_id: INSTANCE});
    expect(seen?.redirect).toBe('error');
    const headers = seen?.headers as Record<string, string>;
    expect(headers.apikey).toBe(SERVICE_KEY);
    expect(headers.authorization).toBe(`Bearer ${SERVICE_KEY}`);
  });

  it('reports a redirect as such, not as unreachable', async () => {
    const redirected: IdentityFetch = async () => {
      throw new TypeError('fetch failed', {cause: new Error('unexpected redirect')});
    };
    const {error, retryable} = await fetchInstanceIdentity(staging, redirected);
    expect(error).toContain('redirect');
    expect(error).not.toContain('unreachable');
    expect(retryable).toBe(false);
  });

  it('reports a timeout as such, and as retryable', async () => {
    const slow: IdentityFetch = async () => {
      throw new DOMException('The operation was aborted due to timeout', 'TimeoutError');
    };
    const {error, retryable} = await fetchInstanceIdentity(staging, slow, 5000);
    expect(error).toContain('did not answer within 5 s');
    expect(error).not.toContain('unreachable');
    expect(retryable).toBe(true);
  });

  it('reports an invalid header value as such without sending anything', async () => {
    let calls = 0;
    const spy: IdentityFetch = async () => {
      calls += 1;
      return new Response(row);
    };
    const {error, retryable} = await fetchInstanceIdentity({...staging, SUPABASE_SERVICE_ROLE_KEY: 'bad\nkey'}, spy);
    expect(error).toContain('not a valid HTTP header value');
    expect(error).not.toContain('unreachable');
    expect(error).not.toContain('bad');
    expect(retryable).toBe(false);
    expect(calls).toBe(0);
  });

  it('reports a network error as unreachable and retryable', async () => {
    const {error, retryable} = await fetchInstanceIdentity(staging, async () => {
      throw new TypeError('fetch failed');
    });
    expect(error).toContain('unreachable');
    expect(retryable).toBe(true);
  });

  it.each([
    [500, true],
    [503, true],
    [400, false],
    [401, false],
    [404, false],
    [406, false],
  ])('treats HTTP %i as retryable=%s', async (status, retryable) => {
    expect((await fetchInstanceIdentity(staging, answer(status, {}))).retryable).toBe(retryable);
  });

  it('treats an absent row, a malformed row and a bad body as final', async () => {
    for (const fetchImpl of [answer(200, []), answer(200, [{environment: 7}]), async () => new Response('<html>')]) {
      expect((await fetchInstanceIdentity(staging, fetchImpl)).retryable).toBe(false);
    }
  });
});

describe('checkInstanceIdentity', () => {
  const match = answer(200, [{environment: 'staging', instance_id: INSTANCE}]);
  const other = '9a1b2c3d-4e5f-4a6b-8c7d-0e1f2a3b4c5d';

  it('is clean and final on a match', async () => {
    expect(await checkInstanceIdentity(staging, match)).toEqual({errors: [], retryable: false});
  });

  it('marks only transient failures retryable', async () => {
    expect((await checkInstanceIdentity(staging, async () => { throw new TypeError('fetch failed'); })).retryable).toBe(true);
    expect((await checkInstanceIdentity(staging, answer(503, {}))).retryable).toBe(true);
    expect((await checkInstanceIdentity(staging, answer(401, {}))).retryable).toBe(false);
    expect((await checkInstanceIdentity(staging, answer(200, []))).retryable).toBe(false);
    expect((await checkInstanceIdentity(staging, answer(200, [{environment: 'staging', instance_id: other}]))).retryable).toBe(false);
    expect((await checkInstanceIdentity({...staging, ADMINISTRATOR_EMAIL: ''}, match)).retryable).toBe(false);
  });

  it('adds a one-line fix hint to a mismatch and prints no UUID or key', async () => {
    const {errors} = await checkInstanceIdentity(staging, answer(200, [{environment: 'staging', instance_id: other}]));
    expect(errors).toHaveLength(2);
    expect(errors[1]).toMatch(/^fix: /);
    expect(errors[1]).not.toContain('\n');
    expect(errors.join()).not.toMatch(new RegExp(`${INSTANCE}|${other}|${SERVICE_KEY}`));
  });

  it('points a local mismatch at setup-env', () => {
    expect(identityMismatchHint({APP_ENV: 'local'})).toBe('fix: run node scripts/setup-env.mjs local after supabase db reset, so INSTANCE_ID follows the local stack');
    expect(identityMismatchHint({APP_ENV: 'staging'})).toContain('INSTANCE_ID');
    expect(identityMismatchHint({APP_ENV: 'staging'})).toContain('docs/deployment-setup.md');
  });
});

describe('hash keys (Story 1.3)', () => {
  const good = () => randomBytes(32).toString('base64');

  it('accept base64 of at least 32 random bytes, standard or URL-safe, padded or not', () => {
    expect(hashKeyProblem(good())).toBeNull();
    expect(hashKeyProblem(randomBytes(32).toString('base64url'))).toBeNull();
    expect(hashKeyProblem(randomBytes(64).toString('base64'))).toBeNull();
    expect(hashKeyProblem(`  ${good()}\n`)).toBeNull();
    expect(decodeHashKey(good())).toHaveLength(32);
  });

  it('reject placeholders, other alphabets, short keys and low-variety keys, naming the problem', () => {
    expect(hashKeyProblem('replace-with-local-invitation-hash-key')).toMatch(/placeholder/);
    expect(hashKeyProblem('<staging-invitation-hash-key>')).toMatch(/placeholder/);
    expect(hashKeyProblem('changeme')).toMatch(/placeholder/);
    expect(hashKeyProblem('this is not base64 text, it has spaces')).toMatch(/base64/);
    expect(hashKeyProblem(randomBytes(31).toString('base64'))).toMatch(/at least 32 bytes/);
    expect(hashKeyProblem(randomBytes(16).toString('base64'))).toMatch(/at least 32 bytes/);
    expect(hashKeyProblem('A'.repeat(64))).toMatch(/not random/);
    expect(hashKeyProblem('ab'.repeat(32))).toMatch(/not random/);
  });

  it('are required outside a preview, so the server does not start without them', () => {
    expect(validateEnvironment(staging)).toEqual([]);
    for (const name of ['INVITATION_HASH_KEY', 'RATE_LIMIT_HASH_KEY']) {
      for (const value of [undefined, '', '  ']) {
        expect(validateEnvironment({...staging, [name]: value}).join('\n'), `${name}=${JSON.stringify(value)}`).toContain(`missing required variables: ${name}`);
      }
    }
    expect(validateEnvironment({...staging, ...noKeys}).join('\n')).toContain('missing required variables: INVITATION_HASH_KEY, RATE_LIMIT_HASH_KEY');
    // The local environment is held to the same rule.
    const local = {...staging, APP_ENV: 'local', NEXT_PUBLIC_APP_ENV: 'local', VERCEL: undefined, VERCEL_ENV: undefined, NEXT_PUBLIC_SUPABASE_URL: 'http://127.0.0.1:54321'};
    expect(validateEnvironment(local)).toEqual([]);
    expect(validateEnvironment({...local, ...noKeys}).join('\n')).toContain('missing required variables');
  });

  it('are not required in a preview, which must not hold them', () => {
    expect(validateEnvironment({...staging, VERCEL_ENV: 'preview', NEXT_PUBLIC_SUPABASE_URL: undefined, NEXT_PUBLIC_SUPABASE_ANON_KEY: undefined, SUPABASE_SERVICE_ROLE_KEY: undefined, ...noKeys})).toEqual([]);
  });

  it('are checked for shape when present, without printing the value', () => {
    expect(validateEnvironment({...staging, INVITATION_HASH_KEY: good(), RATE_LIMIT_HASH_KEY: good()})).toEqual([]);
    const bad = 'short-secret-value-that-must-not-be-echoed';
    const errors = validateEnvironment({...staging, INVITATION_HASH_KEY: bad, RATE_LIMIT_HASH_KEY: '<staging-rate-limit-hash-key>'});
    expect(errors.join('\n')).toMatch(/INVITATION_HASH_KEY must decode to at least 32 bytes/);
    expect(errors.join('\n')).toMatch(/RATE_LIMIT_HASH_KEY is a placeholder/);
    expect(errors.join('\n')).not.toContain(bad);
  });

  it('must differ from each other, compared by the bytes they decode to', () => {
    const bytes = randomBytes(32);
    const same = bytes.toString('base64');
    expect(validateEnvironment({...staging, INVITATION_HASH_KEY: same, RATE_LIMIT_HASH_KEY: same}).join()).toContain('must be different keys');
    // The same key spelled differently is still the same key: URL-safe alphabet, without padding, with padding.
    for (const spelled of [bytes.toString('base64url'), same.replace(/=+$/, ''), `  ${same}  `]) {
      expect(validateEnvironment({...staging, INVITATION_HASH_KEY: same, RATE_LIMIT_HASH_KEY: spelled}).join(), spelled).toContain('must be different keys');
    }
    expect(sameKey(bytes.toString('base64'), bytes.toString('base64url'))).toBe(true);
    expect(validateEnvironment({...staging, INVITATION_HASH_KEY: same, RATE_LIMIT_HASH_KEY: good()})).toEqual([]);
    // Two bad keys are reported as bad, not as equal.
    expect(validateEnvironment({...staging, INVITATION_HASH_KEY: 'short', RATE_LIMIT_HASH_KEY: 'short'}).join()).not.toContain('must be different keys');
  });

  it('are named by the preview rule: a preview or development deployment must hold neither', () => {
    const preview = {...staging, VERCEL_ENV: 'preview', NEXT_PUBLIC_SUPABASE_URL: undefined, NEXT_PUBLIC_SUPABASE_ANON_KEY: undefined, SUPABASE_SERVICE_ROLE_KEY: undefined, ...noKeys};
    expect(validateEnvironment(preview)).toEqual([]);
    for (const name of ['INVITATION_HASH_KEY', 'RATE_LIMIT_HASH_KEY']) {
      for (const environment of ['preview', 'development']) {
        const value = good();
        const errors = validateEnvironment({...preview, VERCEL_ENV: environment, [name]: value});
        expect(errors.join('\n'), `${environment} ${name}`).toMatch(new RegExp(`hold no Supabase, database or Stripe variables or account hashing keys: ${name}$`, 'm'));
        expect(errors.join('\n')).not.toContain(value);
      }
    }
    const both = validateEnvironment({...preview, INVITATION_HASH_KEY: good(), RATE_LIMIT_HASH_KEY: good()});
    expect(both.join()).toContain('INVITATION_HASH_KEY, RATE_LIMIT_HASH_KEY');
    // A deployment that is not a preview may hold them.
    expect(validateEnvironment({...staging, INVITATION_HASH_KEY: good(), RATE_LIMIT_HASH_KEY: good()})).toEqual([]);
  });
});

describe('parseEnvValue (how an env-file value is read)', () => {
  it('ends an unquoted value at a trailing comment and trims it', () => {
    expect(parseEnvValue('abc')).toBe('abc');
    expect(parseEnvValue('  abc  ')).toBe('abc');
    expect(parseEnvValue('abc # a note')).toBe('abc');
    expect(parseEnvValue('abc\t# a note')).toBe('abc');
    expect(parseEnvValue('abc #')).toBe('abc');
    expect(parseEnvValue('abc#not-a-comment')).toBe('abc#not-a-comment');
    expect(parseEnvValue('# only a comment')).toBe('');
    expect(parseEnvValue('')).toBe('');
  });

  it('reads a quoted value up to its closing quote, keeping a # inside it', () => {
    expect(parseEnvValue('"abc"')).toBe('abc');
    expect(parseEnvValue("'abc' # note")).toBe('abc');
    expect(parseEnvValue('"a # b" # note')).toBe('a # b');
    expect(parseEnvValue('"unterminated')).toBe('"unterminated');
  });

  it('lets a key with a trailing comment be judged by its value alone', () => {
    const key = randomBytes(32).toString('base64');
    expect(hashKeyProblem(parseEnvValue(`${key} # generated by me`))).toBeNull();
    expect(hashKeyProblem(`${key} # generated by me`)).not.toBeNull();
  });
});

describe('SEED_ACCOUNT_EMAILS (Story 1.3)', () => {
  it('parses a comma-separated list into lowercase, de-duplicated addresses', () => {
    expect(parseEmailList(' A@b.co,c@d.co , a@B.co,,')).toEqual(['a@b.co', 'c@d.co']);
    expect(parseEmailList(undefined)).toEqual([]);
    expect(parseEmailList('')).toEqual([]);
  });

  it('rejects an address longer than 254 characters, here and in ADMINISTRATOR_EMAIL', () => {
    const local = 'a'.repeat(64);
    const longest = `${local}@${'b'.repeat(63)}.${'c'.repeat(63)}.${'d'.repeat(57)}.com`;
    expect(longest).toHaveLength(254);
    const tooLong = `${longest}x`;
    expect(validateEnvironment({...staging, SEED_ACCOUNT_EMAILS: longest})).toEqual([]);
    expect(validateEnvironment({...staging, SEED_ACCOUNT_EMAILS: `a@b.co, ${tooLong}`}).join()).toContain('SEED_ACCOUNT_EMAILS must be a comma-separated list of email addresses');
    expect(validateEnvironment({...staging, ADMINISTRATOR_EMAIL: longest})).toEqual([]);
    expect(validateEnvironment({...staging, ADMINISTRATOR_EMAIL: tooLong}).join()).toContain('ADMINISTRATOR_EMAIL must be one email address');
  });

  it('is optional and, when present, must hold email addresses', () => {
    expect(validateEnvironment({...staging, SEED_ACCOUNT_EMAILS: 'a@b.co, c@d.co'})).toEqual([]);
    expect(validateEnvironment({...staging, SEED_ACCOUNT_EMAILS: ''})).toEqual([]);
    expect(validateEnvironment({...staging, SEED_ACCOUNT_EMAILS: 'a@b.co, not-an-email'}).join()).toContain('SEED_ACCOUNT_EMAILS must be a comma-separated list of email addresses');
    expect(validateEnvironment({...staging, SEED_ACCOUNT_EMAILS: '<seed-account-emails>'}).join()).toContain('SEED_ACCOUNT_EMAILS');
  });
});

describe('which hashing keys a run needs (the seed command asks only for its own)', () => {
  const good = () => randomBytes(32).toString('base64');
  const withoutKeys = {...staging, ...noKeys};

  it('requires both by default, as the server does', () => {
    expect(validateEnvironment(withoutKeys).join('\n')).toContain('missing required variables: INVITATION_HASH_KEY, RATE_LIMIT_HASH_KEY');
  });

  it('requires none when a command hashes nothing', () => {
    expect(validateEnvironment(withoutKeys, {hashKeys: []})).toEqual([]);
  });

  it('requires only the invitation key for a command that hashes a code', () => {
    const only = {...withoutKeys, INVITATION_HASH_KEY: good()};
    expect(validateEnvironment(only, {hashKeys: ['INVITATION_HASH_KEY']})).toEqual([]);
    expect(validateEnvironment(withoutKeys, {hashKeys: ['INVITATION_HASH_KEY']}).join('\n')).toContain('missing required variables: INVITATION_HASH_KEY');
    expect(validateEnvironment(withoutKeys, {hashKeys: ['INVITATION_HASH_KEY']}).join('\n')).not.toContain('RATE_LIMIT_HASH_KEY');
  });

  it('does not judge a key the command does not use, however it is set', () => {
    const odd = {...withoutKeys, INVITATION_HASH_KEY: good(), RATE_LIMIT_HASH_KEY: 'too-short'};
    expect(validateEnvironment(odd, {hashKeys: ['INVITATION_HASH_KEY']})).toEqual([]);
    expect(validateEnvironment(odd, {hashKeys: []})).toEqual([]);
    expect(validateEnvironment(odd).join('\n')).toContain('RATE_LIMIT_HASH_KEY must decode to at least 32 bytes');
  });

  it('still checks the shape of the keys it does need, and that two needed keys differ', () => {
    expect(validateEnvironment({...withoutKeys, INVITATION_HASH_KEY: 'short'}, {hashKeys: ['INVITATION_HASH_KEY']}).join('\n')).toContain('INVITATION_HASH_KEY must decode to at least 32 bytes');
    const same = good();
    expect(validateEnvironment({...withoutKeys, INVITATION_HASH_KEY: same, RATE_LIMIT_HASH_KEY: same}).join('\n')).toContain('must be different keys');
    // A key the command does not use cannot make two keys "the same".
    expect(validateEnvironment({...withoutKeys, INVITATION_HASH_KEY: same, RATE_LIMIT_HASH_KEY: same}, {hashKeys: ['INVITATION_HASH_KEY']})).toEqual([]);
  });

  it('never asks a preview for keys, whatever the run needs', () => {
    const preview = {...withoutKeys, VERCEL_ENV: 'preview', NEXT_PUBLIC_SUPABASE_URL: undefined, NEXT_PUBLIC_SUPABASE_ANON_KEY: undefined, SUPABASE_SERVICE_ROLE_KEY: undefined};
    expect(validateEnvironment(preview, {hashKeys: ['INVITATION_HASH_KEY']})).toEqual([]);
  });
});

describe('the accounts API preflight (check-env --live)', () => {
  const none = {status: 'none', account_id: null, workspace_id: null, role: null};
  type Seen = {url: string; init?: RequestInit};
  const recorder = (response: () => Response | Promise<Response>) => {
    const seen: Seen[] = [];
    const fetchImpl: IdentityFetch = async (url, init) => {
      seen.push({url, init});
      return response();
    };
    return {seen, fetchImpl};
  };
  const jsonResponse = (status: number, body: unknown) => () => new Response(JSON.stringify(body), {status});

  it('asks api.account_status for the nil UUID with the service role, and accepts none', async () => {
    const {seen, fetchImpl} = recorder(jsonResponse(200, none));
    expect(await checkAccountsApi(staging, fetchImpl)).toEqual({});
    expect(seen).toHaveLength(1);
    expect(seen[0].url).toBe('https://abcdefgh.supabase.co/rest/v1/rpc/account_status');
    expect(seen[0].init?.method).toBe('POST');
    expect(JSON.parse(String(seen[0].init?.body))).toEqual({p_user_id: nilUserId});
    expect(nilUserId).toBe('00000000-0000-0000-0000-000000000000');
    const headers = seen[0].init?.headers as Record<string, string>;
    expect(headers['content-profile']).toBe('api');
    expect(headers.apikey).toBe(SERVICE_KEY);
    expect(headers.authorization).toBe(`Bearer ${SERVICE_KEY}`);
    expect(seen[0].init?.redirect).toBe('error');
  });

  it.each([
    ['the api schema is not exposed', 406, {code: 'PGRST106'}, 'HTTP 406'],
    ['the function is missing (migrations not applied)', 404, {code: 'PGRST202'}, 'HTTP 404'],
    ['the service key is wrong', 401, {message: 'Invalid authentication credentials'}, 'HTTP 401'],
    ['the role may not run it', 403, {code: '42501'}, 'HTTP 403'],
  ])('fails in one line when %s', async (_name, status, body, text) => {
    const {fetchImpl} = recorder(jsonResponse(status, body));
    const result = await checkAccountsApi(staging, fetchImpl);
    expect(result.error).toContain('the accounts API cannot be verified');
    expect(result.error).toContain(text);
    expect(result.error).toContain('api schema exposed');
    expect(result.error).not.toContain('\n');
    expect(result.error).not.toContain(SERVICE_KEY);
    expect(result.retryable).toBe(false);
  });

  it('marks a 5xx and an unreachable database as retryable, and a 4xx as final', async () => {
    expect((await checkAccountsApi(staging, recorder(jsonResponse(503, {})).fetchImpl)).retryable).toBe(true);
    const down = await checkAccountsApi(staging, async () => { throw new TypeError('fetch failed'); });
    expect(down).toMatchObject({retryable: true});
    expect(down.error).toContain('unreachable');
    const slow = await checkAccountsApi(staging, async () => { throw new DOMException('timed out', 'TimeoutError'); });
    expect(slow.error).toContain('did not answer within 5 s');
  });

  it.each([
    ['anything but none', {status: 'active', account_id: 'x'}],
    ['an empty answer', {}],
    ['a list', [none]],
    ['null', null],
  ])('fails when the answer is %s', async (_name, body) => {
    const result = await checkAccountsApi(staging, recorder(jsonResponse(200, body)).fetchImpl);
    expect(result.error).toContain('did not answer "none" for the nil UUID');
    expect(result.retryable).toBe(false);
  });

  it('fails on a body that is not JSON, without printing it', async () => {
    const result = await checkAccountsApi(staging, recorder(() => new Response('<html>secret</html>')).fetchImpl);
    expect(result.error).toContain('did not answer with JSON');
    expect(result.error).not.toContain('secret');
  });

  it('needs a URL and a key, refuses a key that cannot be a header, and sends nothing in those cases', async () => {
    const {seen, fetchImpl} = recorder(jsonResponse(200, none));
    expect((await checkAccountsApi({}, fetchImpl)).error).toContain('missing');
    expect((await checkAccountsApi({...staging, NEXT_PUBLIC_SUPABASE_URL: 'nope'}, fetchImpl)).error).toContain('not a valid URL');
    expect((await checkAccountsApi({...staging, SUPABASE_SERVICE_ROLE_KEY: 'bad\nkey'}, fetchImpl)).error).toContain('not a valid HTTP header value');
    expect(seen).toEqual([]);
  });

  it('runs after the identity check, and only when asked', async () => {
    const calls: string[] = [];
    const both: IdentityFetch = async (url) => {
      calls.push(new URL(url).pathname);
      return url.includes('instance_identity') ? new Response(JSON.stringify([{environment: 'staging', instance_id: INSTANCE}])) : new Response(JSON.stringify(none));
    };
    expect(await checkInstanceIdentity(staging, both)).toEqual({errors: [], retryable: false});
    expect(calls).toEqual(['/rest/v1/instance_identity']);
    calls.length = 0;
    expect(await checkInstanceIdentity(staging, both, {accountsApi: true})).toEqual({errors: [], retryable: false});
    expect(calls).toEqual(['/rest/v1/instance_identity', '/rest/v1/rpc/account_status']);
  });

  it('fails the check when the preflight fails, and keeps the retry flag of the failure', async () => {
    const answer: IdentityFetch = async (url) =>
      url.includes('instance_identity') ? new Response(JSON.stringify([{environment: 'staging', instance_id: INSTANCE}])) : new Response('{}', {status: 404});
    const result = await checkInstanceIdentity(staging, answer, {accountsApi: true});
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toContain('the accounts API cannot be verified');
    expect(result.retryable).toBe(false);
    const flaky: IdentityFetch = async (url) => (url.includes('instance_identity') ? new Response(JSON.stringify([{environment: 'staging', instance_id: INSTANCE}])) : new Response('{}', {status: 503}));
    expect((await checkInstanceIdentity(staging, flaky, {accountsApi: true})).retryable).toBe(true);
  });

  it('does not run when the identity does not match, and never runs for a preview', async () => {
    const calls: string[] = [];
    const mismatch: IdentityFetch = async (url) => {
      calls.push(url);
      return new Response(JSON.stringify([{environment: 'staging', instance_id: '9a1b2c3d-4e5f-4a6b-8c7d-0e1f2a3b4c5d'}]));
    };
    expect((await checkInstanceIdentity(staging, mismatch, {accountsApi: true})).errors.join()).toContain('instance mismatch');
    expect(calls).toHaveLength(1);
    calls.length = 0;
    const preview = {...staging, VERCEL_ENV: 'preview', NEXT_PUBLIC_SUPABASE_URL: undefined, NEXT_PUBLIC_SUPABASE_ANON_KEY: undefined, SUPABASE_SERVICE_ROLE_KEY: undefined, ...noKeys};
    expect(await checkInstanceIdentity(preview, mismatch, {accountsApi: true})).toEqual({errors: [], retryable: false});
    expect(calls).toEqual([]);
  });
});
