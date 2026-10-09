import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';
import {register} from '@/instrumentation';
import {verifyStartupIdentity} from '@/instrumentation-node';

const INSTANCE = '3f0d6c1e-8a52-4c1b-9d57-2b6a1f0e7c44';
const OTHER = '9a1b2c3d-4e5f-4a6b-8c7d-0e1f2a3b4c5d';
const KEY = 'startup-fixture-service-key-must-never-be-printed';
const URL = 'https://abcdefgh.supabase.co';
const noWait = {backoffMs: [0, 0]};

const stagingEnv: Record<string, string | undefined> = {
  APP_ENV: 'staging',
  NEXT_PUBLIC_APP_ENV: 'staging',
  NEXT_PUBLIC_SUPABASE_URL: URL,
  NEXT_PUBLIC_SUPABASE_ANON_KEY: 'anon-fixture',
  SUPABASE_SERVICE_ROLE_KEY: KEY,
  ADMINISTRATOR_EMAIL: 'admin@example.com',
  INSTANCE_ID: INSTANCE,
  AUTH_ALLOWED_EMAILS: 'admin@example.com',
  PAID_ADAPTERS_ENABLED: 'false',
  SYNTHETIC_DATA_ENABLED: 'true',
  VERCEL: undefined,
  VERCEL_ENV: undefined,
  NEXT_RUNTIME: undefined,
  NEXT_PHASE: undefined,
};

const rowResponse = (environment: string, instanceId: string) => () =>
  Promise.resolve(new Response(JSON.stringify([{environment, instance_id: instanceId}]), {status: 200}));
const status = (code: number) => () => Promise.resolve(new Response('{}', {status: code}));
const down = () => Promise.reject(new TypeError('fetch failed'));

let exit: ReturnType<typeof vi.spyOn>;
let error: ReturnType<typeof vi.spyOn>;
let fetchStub: ReturnType<typeof vi.fn>;

function env(overrides: Record<string, string | undefined> = {}) {
  for (const [name, value] of Object.entries({...stagingEnv, ...overrides})) vi.stubEnv(name, value);
}
function respondWith(...handlers: (() => Promise<Response>)[]) {
  let call = 0;
  fetchStub = vi.fn(() => handlers[Math.min(call++, handlers.length - 1)]());
  vi.stubGlobal('fetch', fetchStub);
}
const printed = () => [...error.mock.calls, ...vi.mocked(console.warn).mock.calls].flat().join('\n');

beforeEach(() => {
  // A real exit would end the test run; throwing also proves nothing runs after it.
  exit = vi.spyOn(process, 'exit').mockImplementation(((code?: number) => {
    throw new Error(`process.exit(${code})`);
  }) as never);
  error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
  vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  env();
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('verifyStartupIdentity', () => {
  it('lets a matching identity start', async () => {
    respondWith(rowResponse('staging', INSTANCE));
    await expect(verifyStartupIdentity(noWait)).resolves.toBeUndefined();
    expect(exit).not.toHaveBeenCalled();
    expect(fetchStub).toHaveBeenCalledTimes(1);
  });

  it('exits 1 on a UUID mismatch, naming it with a fix and no UUID or key, without retrying', async () => {
    respondWith(rowResponse('staging', OTHER));
    await expect(verifyStartupIdentity(noWait)).rejects.toThrow('process.exit(1)');
    expect(fetchStub).toHaveBeenCalledTimes(1);
    const text = printed();
    expect(text).toContain('staging');
    expect(text).toContain('INSTANCE_ID differs from the instance_identity row');
    expect(text).toContain('fix:');
    for (const secret of [INSTANCE, OTHER, KEY]) expect(text).not.toContain(secret);
  });

  it('exits 1 on an environment mismatch, naming both labels', async () => {
    respondWith(rowResponse('production', INSTANCE));
    await expect(verifyStartupIdentity(noWait)).rejects.toThrow('process.exit(1)');
    expect(fetchStub).toHaveBeenCalledTimes(1);
    expect(printed()).toContain('row says "production" but APP_ENV is "staging"');
  });

  it('exits 1 when the row is absent, without retrying', async () => {
    respondWith(() => Promise.resolve(new Response('[]', {status: 200})));
    await expect(verifyStartupIdentity(noWait)).rejects.toThrow('process.exit(1)');
    expect(fetchStub).toHaveBeenCalledTimes(1);
    expect(printed()).toContain('no row');
  });

  it('exits 1 on a 4xx without retrying', async () => {
    respondWith(status(401));
    await expect(verifyStartupIdentity(noWait)).rejects.toThrow('process.exit(1)');
    expect(fetchStub).toHaveBeenCalledTimes(1);
    expect(printed()).toContain('HTTP 401');
  });

  it('retries an unreachable database twice, then exits 1 (fail closed)', async () => {
    respondWith(down);
    await expect(verifyStartupIdentity(noWait)).rejects.toThrow('process.exit(1)');
    expect(fetchStub).toHaveBeenCalledTimes(3);
    const text = printed();
    expect(text).toContain('unreachable');
    expect(text).not.toContain(KEY);
  });

  it('retries a timeout and a 5xx, and starts when one retry succeeds', async () => {
    respondWith(
      () => Promise.reject(new DOMException('timed out', 'TimeoutError')),
      status(503),
      rowResponse('staging', INSTANCE),
    );
    await expect(verifyStartupIdentity(noWait)).resolves.toBeUndefined();
    expect(fetchStub).toHaveBeenCalledTimes(3);
    expect(exit).not.toHaveBeenCalled();
  });

  it('does not retry a mismatch that follows a transient failure', async () => {
    respondWith(down, rowResponse('staging', OTHER));
    await expect(verifyStartupIdentity(noWait)).rejects.toThrow('process.exit(1)');
    expect(fetchStub).toHaveBeenCalledTimes(2);
  });

  it('waits the configured backoff between attempts', async () => {
    vi.useFakeTimers();
    try {
      respondWith(down, rowResponse('staging', INSTANCE));
      const done = verifyStartupIdentity({backoffMs: [250, 750]});
      await vi.advanceTimersByTimeAsync(0);
      expect(fetchStub).toHaveBeenCalledTimes(1);
      await vi.advanceTimersByTimeAsync(249);
      expect(fetchStub).toHaveBeenCalledTimes(1);
      await vi.advanceTimersByTimeAsync(1);
      await done;
      expect(fetchStub).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it('exits 1 on a label error without contacting the database', async () => {
    env({ADMINISTRATOR_EMAIL: ''});
    respondWith(rowResponse('staging', INSTANCE));
    await expect(verifyStartupIdentity(noWait)).rejects.toThrow('process.exit(1)');
    expect(fetchStub).not.toHaveBeenCalled();
    expect(printed()).toContain('ADMINISTRATOR_EMAIL');
  });

  it('never contacts the database for a preview', async () => {
    env({VERCEL: '1', VERCEL_ENV: 'preview', NEXT_PUBLIC_SUPABASE_URL: undefined, NEXT_PUBLIC_SUPABASE_ANON_KEY: undefined, SUPABASE_SERVICE_ROLE_KEY: undefined});
    respondWith(rowResponse('production', OTHER));
    await expect(verifyStartupIdentity(noWait)).resolves.toBeUndefined();
    expect(fetchStub).not.toHaveBeenCalled();
    expect(exit).not.toHaveBeenCalled();
  });

  it('fails startup when the local identity is mixed and says how to fix it', async () => {
    env({APP_ENV: 'local', NEXT_PUBLIC_APP_ENV: 'local', NEXT_PUBLIC_SUPABASE_URL: 'http://127.0.0.1:54321'});
    respondWith(rowResponse('local', OTHER));
    await expect(verifyStartupIdentity(noWait)).rejects.toThrow('process.exit(1)');
    expect(printed()).toContain('run node scripts/setup-env.mjs local after supabase db reset');
  });
});

describe('register', () => {
  it('verifies the identity under the Node runtime', async () => {
    env({NEXT_RUNTIME: 'nodejs'});
    respondWith(rowResponse('staging', OTHER));
    await expect(register()).rejects.toThrow('process.exit(1)');
    expect(fetchStub).toHaveBeenCalledTimes(1);
  });

  it('lets a matching identity start under the Node runtime', async () => {
    env({NEXT_RUNTIME: 'nodejs'});
    respondWith(rowResponse('staging', INSTANCE));
    await expect(register()).resolves.toBeUndefined();
    expect(fetchStub).toHaveBeenCalledTimes(1);
    expect(exit).not.toHaveBeenCalled();
  });

  it('skips the check during the production build, so a credential-free build succeeds', async () => {
    env({NEXT_RUNTIME: 'nodejs', NEXT_PHASE: 'phase-production-build', APP_ENV: undefined, INSTANCE_ID: undefined});
    respondWith(rowResponse('production', OTHER));
    await expect(register()).resolves.toBeUndefined();
    expect(fetchStub).not.toHaveBeenCalled();
    expect(exit).not.toHaveBeenCalled();
  });

  it.each(['edge', undefined])('skips the check under the %s runtime', async (runtime) => {
    env({NEXT_RUNTIME: runtime});
    respondWith(rowResponse('production', OTHER));
    await expect(register()).resolves.toBeUndefined();
    expect(fetchStub).not.toHaveBeenCalled();
    expect(exit).not.toHaveBeenCalled();
  });
});
