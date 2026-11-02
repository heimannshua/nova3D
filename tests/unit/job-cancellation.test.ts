import {randomBytes} from 'node:crypto';
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';

// The canceller of Jobs (Story 2.7, lib/job-cancellation.ts): importing the module registers a canceller named `jobs` once per process, which calls api.cancel_account_jobs for
// the Account whose disable has committed and returns how many attempts it cancelled; instrumentation.ts imports it for the Node runtime only. The database is a stand-in for the
// one call it makes; api.cancel_account_jobs itself is tested against the real database in tests/integration/job-dispatch.test.ts.
const ACCOUNT = '7a1b2c3d-4e5f-4a6b-8c7d-0e1f2a3b4c5d';
const INSTANCE = '3f0d6c1e-8a52-4c1b-9d57-2b6a1f0e7c44';
const KEY = 'service-key-must-never-appear-anywhere';
const registryKey = Symbol.for('nova3d.authority.cancellers');

/** The registry cancellers live in is the process's (globalThis), so a test starts from an empty one. */
const clearRegistry = () => (globalThis as unknown as Record<symbol, Map<string, unknown> | undefined>)[registryKey]?.clear();

const stagingEnv: Record<string, string | undefined> = {
  APP_ENV: 'staging',
  NEXT_PUBLIC_APP_ENV: 'staging',
  NEXT_PUBLIC_SUPABASE_URL: 'https://abcdefgh.supabase.co',
  NEXT_PUBLIC_SUPABASE_ANON_KEY: 'anon-fixture',
  SUPABASE_SERVICE_ROLE_KEY: KEY,
  ADMINISTRATOR_EMAIL: 'admin@example.com',
  INSTANCE_ID: INSTANCE,
  PAID_ADAPTERS_ENABLED: 'false',
  SYNTHETIC_DATA_ENABLED: 'true',
  INVITATION_HASH_KEY: randomBytes(32).toString('base64'),
  RATE_LIMIT_HASH_KEY: randomBytes(32).toString('base64'),
  RECOVERY_HASH_KEY: randomBytes(32).toString('base64'),
  RESEND_API_KEY: 'resend-fixture-must-never-be-printed',
  APP_ORIGIN: 'https://nova3d-staging.example.test',
  VERCEL: undefined,
  VERCEL_ENV: undefined,
  NEXT_RUNTIME: undefined,
  NEXT_PHASE: undefined,
};
function env(overrides: Record<string, string | undefined> = {}) {
  for (const [name, value] of Object.entries({...stagingEnv, ...overrides})) vi.stubEnv(name, value);
}

type Call = {url: string; body: Record<string, unknown>};
/** A database that answers the identity read as the environment's own and api.cancel_account_jobs with `cancel`. */
function database(cancel: () => Response | Promise<Response>) {
  const calls: Call[] = [];
  const stub = vi.fn(async (input: string, init?: RequestInit) => {
    const url = String(input);
    if (url.includes('/rest/v1/instance_identity')) return new Response(JSON.stringify([{environment: 'staging', instance_id: INSTANCE}]), {status: 200});
    calls.push({url, body: JSON.parse(String(init?.body ?? '{}'))});
    return cancel();
  });
  vi.stubGlobal('fetch', stub);
  return {calls, stub};
}
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {status, headers: {'content-type': 'application/json'}});

beforeEach(() => {
  clearRegistry();
  vi.resetModules();
  env();
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
  vi.spyOn(console, 'warn').mockImplementation(() => undefined);
});
afterEach(() => {
  clearRegistry();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('the canceller of Jobs', () => {
  it('registers itself when the module is imported: one canceller, named `jobs`', async () => {
    const authority = await import('@/lib/authority');
    expect(authority.cancellerNames()).toEqual([]);
    const cancellation = await import('@/lib/job-cancellation');
    expect(authority.cancellerNames()).toEqual(['jobs']);
    expect(cancellation.jobCancellerName).toBe('jobs');
  });

  it('registers nothing the second time: another call, or another evaluation of the module, finds the canceller there and leaves it as it is', async () => {
    const authority = await import('@/lib/authority');
    const cancellation = await import('@/lib/job-cancellation');
    const remove = cancellation.registerJobCanceller();
    expect(authority.cancellerNames()).toEqual(['jobs']);
    // The remover of a registration that did nothing removes nothing: the first canceller is still the Account's.
    remove();
    expect(authority.cancellerNames()).toEqual(['jobs']);
    // A second evaluation of the module (the registry is the process's, not the module's) does not throw "already registered".
    vi.resetModules();
    await expect(import('@/lib/job-cancellation')).resolves.toBeDefined();
    expect((await import('@/lib/authority')).cancellerNames()).toEqual(['jobs']);
  });

  it('returns a remover that unregisters it, and registers again after that', async () => {
    const authority = await import('@/lib/authority');
    clearRegistry();
    const cancellation = await import('@/lib/job-cancellation');
    expect(authority.cancellerNames()).toEqual(['jobs']);
    // (The import registered it; remove that one through the registry, then register through the function.)
    clearRegistry();
    const remove = cancellation.registerJobCanceller();
    expect(authority.cancellerNames()).toEqual(['jobs']);
    remove();
    expect(authority.cancellerNames()).toEqual([]);
    cancellation.registerJobCanceller();
    expect(authority.cancellerNames()).toEqual(['jobs']);
  });

  it('calls api.cancel_account_jobs for the Account that was disabled, sending the Account and nothing else, and returns the count it cancelled', async () => {
    const {calls} = database(() => json({cancelled: 2, settled: 1}));
    const authority = await import('@/lib/authority');
    await import('@/lib/job-cancellation');
    const report = await authority.runCancellers({accountId: ACCOUNT, epoch: 5}, {log: () => undefined});
    expect(report).toEqual({cancellers: 1, cancelled: 2, failed: 0});
    expect(calls).toEqual([{url: 'https://abcdefgh.supabase.co/rest/v1/rpc/cancel_account_jobs', body: {p_account_id: ACCOUNT}}]);
  });

  it('is safe to run twice: the second run finds nothing open and reports zero', async () => {
    let open = 3;
    database(() => {
      const cancelled = open;
      open = 0;
      return json({cancelled, settled: 0});
    });
    const authority = await import('@/lib/authority');
    await import('@/lib/job-cancellation');
    expect((await authority.runCancellers({accountId: ACCOUNT, epoch: 5}, {log: () => undefined})).cancelled).toBe(3);
    expect(await authority.runCancellers({accountId: ACCOUNT, epoch: 5}, {log: () => undefined})).toEqual({cancellers: 1, cancelled: 0, failed: 0});
  });

  it('counts itself as failed, and says so in one line without a key or an ID, when the database does not answer: the disable stands, and the next sweep finishes the work', async () => {
    database(() => json({message: 'down'}, 503));
    const authority = await import('@/lib/authority');
    await import('@/lib/job-cancellation');
    const lines: string[] = [];
    const report = await authority.runCancellers({accountId: ACCOUNT, epoch: 5}, {log: (message, detail) => lines.push(`${message} ${detail}`)});
    expect(report).toEqual({cancellers: 1, cancelled: 0, failed: 1});
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain('jobs');
    expect(lines[0]).not.toContain(KEY);
    expect(lines[0]).not.toContain(ACCOUNT);
  });

  it('counts an answer that is not an answer as failed too: it never invents a count', async () => {
    database(() => json('nonsense'));
    const authority = await import('@/lib/authority');
    await import('@/lib/job-cancellation');
    expect(await authority.runCancellers({accountId: ACCOUNT, epoch: 5}, {log: () => undefined})).toEqual({cancellers: 1, cancelled: 0, failed: 1});
  });

  it('refuses an Account that is not an ID without asking the database, and counts that as a failure of the canceller alone', async () => {
    const {calls} = database(() => json({cancelled: 0, settled: 0}));
    const authority = await import('@/lib/authority');
    await import('@/lib/job-cancellation');
    expect(await authority.runCancellers({accountId: 'nope', epoch: 5}, {log: () => undefined})).toEqual({cancellers: 1, cancelled: 0, failed: 1});
    expect(calls).toEqual([]);
  });

  it('runs beside the other cancellers and never stops them: another canceller\'s count is added to its own', async () => {
    database(() => json({cancelled: 2, settled: 0}));
    const authority = await import('@/lib/authority');
    await import('@/lib/job-cancellation');
    authority.registerCanceller({name: 'other', cancel: async () => 4});
    expect(await authority.runCancellers({accountId: ACCOUNT, epoch: 5}, {log: () => undefined})).toEqual({cancellers: 2, cancelled: 6, failed: 0});
  });
});

describe('instrumentation.ts imports it for the Node runtime only (Story 2.7)', () => {
  const identityOk = () => database(() => json({cancelled: 0, settled: 0}));

  it('registers the canceller under the Node runtime, after the identity of the environment is verified', async () => {
    env({NEXT_RUNTIME: 'nodejs'});
    const {calls} = identityOk();
    const authority = await import('@/lib/authority');
    expect(authority.cancellerNames()).toEqual([]);
    const {register} = await import('@/instrumentation');
    await expect(register()).resolves.toBeUndefined();
    expect(authority.cancellerNames()).toEqual(['jobs']);
    // Starting up cancels nothing and asks the database nothing but the identity.
    expect(calls).toEqual([]);
  });

  it('does not register it when the identity check fails: the process exits first', async () => {
    env({NEXT_RUNTIME: 'nodejs', INSTANCE_ID: '9a1b2c3d-4e5f-4a6b-8c7d-0e1f2a3b4c5d'});
    identityOk();
    const exit = vi.spyOn(process, 'exit').mockImplementation(((code?: number) => {
      throw new Error(`process.exit(${code})`);
    }) as never);
    const authority = await import('@/lib/authority');
    const {register} = await import('@/instrumentation');
    await expect(register()).rejects.toThrow('process.exit(1)');
    expect(exit).toHaveBeenCalledWith(1);
    expect(authority.cancellerNames()).toEqual([]);
  });

  it.each(['edge', undefined])('registers nothing under the %s runtime', async (runtime) => {
    env({NEXT_RUNTIME: runtime});
    const {stub} = identityOk();
    const authority = await import('@/lib/authority');
    const {register} = await import('@/instrumentation');
    await expect(register()).resolves.toBeUndefined();
    expect(authority.cancellerNames()).toEqual([]);
    expect(stub).not.toHaveBeenCalled();
  });

  it('registers nothing during the production build, so a credential-free build neither asks the database nor loads the module', async () => {
    env({NEXT_RUNTIME: 'nodejs', NEXT_PHASE: 'phase-production-build', APP_ENV: undefined, INSTANCE_ID: undefined});
    const {stub} = identityOk();
    const authority = await import('@/lib/authority');
    const {register} = await import('@/instrumentation');
    await expect(register()).resolves.toBeUndefined();
    expect(authority.cancellerNames()).toEqual([]);
    expect(stub).not.toHaveBeenCalled();
  });
});
