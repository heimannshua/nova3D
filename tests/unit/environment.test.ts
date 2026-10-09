import {describe, expect, it} from 'vitest';
import {checkInstanceIdentity, compareIdentity, fetchInstanceIdentity, identityMismatchHint, isLoopbackUrl, validateEnvironment, verifyInstanceIdentity, type Env, type IdentityFetch} from '@/lib/environment';

const INSTANCE = '3f0d6c1e-8a52-4c1b-9d57-2b6a1f0e7c44';
const SERVICE_KEY = 'fixture-service-key-must-never-be-returned';

const staging: Env = {
  APP_ENV: 'staging',
  NEXT_PUBLIC_APP_ENV: 'staging',
  NEXT_PUBLIC_SUPABASE_URL: 'https://abcdefgh.supabase.co',
  NEXT_PUBLIC_SUPABASE_ANON_KEY: 'anon',
  SUPABASE_SERVICE_ROLE_KEY: SERVICE_KEY,
  ADMINISTRATOR_EMAIL: 'admin@example.com',
  INSTANCE_ID: INSTANCE,
  AUTH_ALLOWED_EMAILS: 'admin@example.com',
  PAID_ADAPTERS_ENABLED: 'false',
  SYNTHETIC_DATA_ENABLED: 'true',
  VERCEL: '1',
  VERCEL_ENV: 'production',
};

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
    const preview = {...staging, VERCEL_ENV: 'preview', NEXT_PUBLIC_SUPABASE_URL: undefined, NEXT_PUBLIC_SUPABASE_ANON_KEY: undefined, SUPABASE_SERVICE_ROLE_KEY: undefined};
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
      AUTH_ALLOWED_EMAILS: 'admin@example.com',
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
        expect(validateEnvironment({...staging, ADMINISTRATOR_EMAIL: email, AUTH_ALLOWED_EMAILS: email}), email).toEqual([]);
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
    const preview = {...staging, VERCEL_ENV: 'preview', NEXT_PUBLIC_SUPABASE_URL: undefined, NEXT_PUBLIC_SUPABASE_ANON_KEY: undefined, SUPABASE_SERVICE_ROLE_KEY: undefined};
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
