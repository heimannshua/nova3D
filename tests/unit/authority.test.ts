import {randomBytes} from 'node:crypto';
import {afterEach, describe, expect, it, vi} from 'vitest';
import {authorizeStep, cancellerNames, operationOf, registerCanceller, runCancellers, type Operation} from '@/lib/authority';
import type {Env} from '@/lib/environment';

// The authority contract (Story 1.5, lib/authority.ts) without a database: a stand-in for the service-role endpoint answers what
// api.guard_operation would, and the cancellers are plain functions.
const SERVICE_KEY = 'service-key-must-never-appear-anywhere';
const ACCOUNT = '7a1b2c3d-4e5f-4a6b-8c7d-0e1f2a3b4c5d';
const env = (): Env => ({
  NEXT_PUBLIC_SUPABASE_URL: 'http://127.0.0.1:54321/',
  SUPABASE_SERVICE_ROLE_KEY: SERVICE_KEY,
  INVITATION_HASH_KEY: randomBytes(32).toString('base64'),
  RATE_LIMIT_HASH_KEY: randomBytes(32).toString('base64'),
});
const operation: Operation = {accountId: ACCOUNT, epoch: 3};

function endpoint(answer: (body: Record<string, unknown>) => {status?: number; body: unknown}) {
  const calls: {url: string; body: Record<string, unknown>}[] = [];
  const fetch = async (url: string, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>;
    calls.push({url, body});
    const reply = answer(body);
    return new Response(JSON.stringify(reply.body), {status: reply.status ?? 200, headers: {'content-type': 'application/json'}});
  };
  return {calls, fetch};
}

const logged = () => {
  const lines: string[] = [];
  return {lines, log: (message: string, detail: string) => lines.push(`${message} ${detail}`)};
};

describe('operationOf', () => {
  it('registers an operation under the Account and the epoch of the live authorization, and keeps nothing else', () => {
    expect(operationOf({accountId: ACCOUNT, epoch: 3, role: 'member', workspaceId: 'w'} as never)).toEqual({accountId: ACCOUNT, epoch: 3});
  });
});

describe('authorizeStep', () => {
  it('allows a step only when the database says allowed, and asks about the Account and the epoch the operation registered under', async () => {
    const {calls, fetch} = endpoint(() => ({body: {outcome: 'allowed', epoch: 3}}));
    const {lines, log} = logged();
    expect(await authorizeStep(operation, {env: env(), fetch, log})).toEqual({allowed: true, epoch: 3});
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe('http://127.0.0.1:54321/rest/v1/rpc/guard_operation');
    expect(calls[0].body).toEqual({p_account_id: ACCOUNT, p_epoch: 3});
    expect(lines).toEqual([]);
  });

  it.each([
    ['disabled', 4],
    ['stale_epoch', 5],
    ['no_account', null],
  ] as const)('denies a step with the reason %s', async (outcome, epoch) => {
    const {fetch} = endpoint(() => ({body: {outcome, epoch}}));
    expect(await authorizeStep(operation, {env: env(), fetch, log: logged().log})).toEqual({allowed: false, reason: outcome});
  });

  it('denies, as unreachable, when the database cannot be reached, errors, or refuses the call, and logs a name and a message only', async () => {
    for (const fetch of [
      async () => {
        throw new TypeError('fetch failed');
      },
      endpoint(() => ({status: 503, body: {}})).fetch,
      endpoint(() => ({status: 400, body: {code: '22023'}})).fetch,
    ]) {
      const {lines, log} = logged();
      expect(await authorizeStep(operation, {env: env(), fetch, log})).toEqual({allowed: false, reason: 'unreachable'});
      expect(lines).toHaveLength(1);
      expect(lines[0]).toContain('denied');
      expect(lines[0]).not.toContain(SERVICE_KEY);
      expect(lines[0]).not.toContain(ACCOUNT);
    }
  });

  it.each([
    ['an outcome it does not know', {outcome: 'ok', epoch: 3}],
    ['an allowed that names no epoch', {outcome: 'allowed', epoch: null}],
    ['nothing', {}],
    ['text', 'allowed'],
    ['a list', [{outcome: 'allowed', epoch: 3}]],
  ])('denies, as unreachable, an answer that is %s: it is no answer, and never permission', async (_name, body) => {
    expect(await authorizeStep(operation, {env: env(), fetch: endpoint(() => ({body})).fetch, log: logged().log})).toEqual({allowed: false, reason: 'unreachable'});
  });

  it('denies, as unreachable, when the service is not configured (nothing can be asked)', async () => {
    expect(await authorizeStep(operation, {env: {}, log: logged().log})).toEqual({allowed: false, reason: 'unreachable'});
  });

  it('denies, as invalid, an operation that is not shaped like one, without asking the database', async () => {
    const {calls, fetch} = endpoint(() => ({body: {outcome: 'allowed', epoch: 1}}));
    for (const bad of [
      {accountId: 'nope', epoch: 3},
      {accountId: ACCOUNT, epoch: 0},
      {accountId: ACCOUNT, epoch: 1.5},
      {accountId: ACCOUNT, epoch: Number.NaN},
      {accountId: ACCOUNT, epoch: '3' as never},
      {accountId: '' as never, epoch: 3},
    ]) {
      expect(await authorizeStep(bad, {env: env(), fetch, log: logged().log}), JSON.stringify(bad)).toEqual({allowed: false, reason: 'invalid'});
    }
    expect(calls).toHaveLength(0);
  });

  it('never throws', async () => {
    await expect(authorizeStep(undefined as never, {env: env(), log: logged().log})).resolves.toMatchObject({allowed: false});
    await expect(authorizeStep(null as never, {env: env(), log: logged().log})).resolves.toMatchObject({allowed: false});
  });
});

describe('the cancellers', () => {
  const removers: (() => void)[] = [];
  const register = (name: string, cancel: (target: {accountId: string; epoch: number}) => Promise<number>) => {
    removers.push(registerCanceller({name, cancel}));
  };
  afterEach(() => {
    for (const remove of removers.splice(0)) remove();
  });

  it('has none today, so a disable cancels nothing and says so with zeros', async () => {
    expect(cancellerNames()).toEqual([]);
    expect(await runCancellers({accountId: ACCOUNT, epoch: 4}, {log: logged().log})).toEqual({cancellers: 0, cancelled: 0, failed: 0});
  });

  it('registers a canceller under a unique name, and the function it returns removes it', () => {
    const cancel = async () => 0;
    const remove = registerCanceller({name: 'research-jobs', cancel});
    expect(cancellerNames()).toEqual(['research-jobs']);
    expect(() => registerCanceller({name: 'research-jobs', cancel})).toThrow('already registered');
    remove();
    expect(cancellerNames()).toEqual([]);
    // Removing twice, or after another canceller took the name, removes nothing else.
    const other = registerCanceller({name: 'research-jobs', cancel});
    remove();
    expect(cancellerNames()).toEqual(['research-jobs']);
    other();
  });

  it.each(['', 'Research', 'jobs now', '1jobs', 'a'.repeat(65), undefined, 7])('refuses a canceller named %j', (name) => {
    expect(() => registerCanceller({name: name as never, cancel: async () => 0})).toThrow(TypeError);
  });

  it('refuses a canceller that has nothing to call', () => {
    expect(() => registerCanceller({name: 'nothing', cancel: undefined as never})).toThrow(TypeError);
    expect(() => registerCanceller(null as never)).toThrow(TypeError);
  });

  it('runs every canceller with the Account and the epoch the disable raised it to, and adds up the Jobs they cancelled', async () => {
    const seen: unknown[] = [];
    register('research', async (target) => {
      seen.push(['research', target]);
      return 2;
    });
    register('exports', async (target) => {
      seen.push(['exports', target]);
      return 3;
    });
    expect(await runCancellers({accountId: ACCOUNT, epoch: 4}, {log: logged().log})).toEqual({cancellers: 2, cancelled: 5, failed: 0});
    expect(seen).toHaveLength(2);
    expect(seen).toContainEqual(['research', {accountId: ACCOUNT, epoch: 4}]);
    expect(seen).toContainEqual(['exports', {accountId: ACCOUNT, epoch: 4}]);
  });

  it('counts a canceller that throws or answers something that is not a count as failed, and still runs the others', async () => {
    const lines = logged();
    register('breaks', async () => {
      throw new Error('queue unreachable');
    });
    register('throws-at-once', () => {
      throw new Error('not even a promise');
    });
    register('lies', async () => 'three' as never);
    register('negative', async () => -1);
    register('fine', async () => 4);
    expect(await runCancellers({accountId: ACCOUNT, epoch: 4}, {log: lines.log})).toEqual({cancellers: 5, cancelled: 4, failed: 4});
    expect(lines.lines.filter((line) => line.includes('did not finish'))).toHaveLength(4);
    expect(lines.lines.join('\n')).toContain('queue unreachable');
    expect(lines.lines.join('\n')).not.toContain(ACCOUNT);
  });

  it('counts a canceller that takes too long as failed, without waiting for it, and still runs the others', async () => {
    vi.useFakeTimers();
    try {
      register('hangs', () => new Promise<number>(() => undefined));
      register('fine', async () => 1);
      const running = runCancellers({accountId: ACCOUNT, epoch: 4}, {timeoutMs: 50, log: logged().log});
      await vi.advanceTimersByTimeAsync(60);
      expect(await running).toEqual({cancellers: 2, cancelled: 1, failed: 1});
    } finally {
      vi.useRealTimers();
    }
  });

  it('runs them together, not one after the other', async () => {
    vi.useFakeTimers();
    try {
      const started: string[] = [];
      for (const name of ['a', 'b', 'c']) {
        register(name, async () => {
          started.push(name);
          await new Promise((resolve) => setTimeout(resolve, 1000));
          return 1;
        });
      }
      const running = runCancellers({accountId: ACCOUNT, epoch: 4}, {timeoutMs: 5000, log: logged().log});
      await vi.advanceTimersByTimeAsync(10);
      expect(started.sort()).toEqual(['a', 'b', 'c']);
      await vi.advanceTimersByTimeAsync(1100);
      expect(await running).toEqual({cancellers: 3, cancelled: 3, failed: 0});
    } finally {
      vi.useRealTimers();
    }
  });

  it('never throws', async () => {
    register('breaks', async () => {
      throw new Error('boom');
    });
    await expect(runCancellers({accountId: ACCOUNT, epoch: 4}, {log: logged().log})).resolves.toEqual({cancellers: 1, cancelled: 0, failed: 1});
  });

  it('is shared by every copy of the module, because Next.js can load it once for a Server Action and again for a route', async () => {
    register('shared', async () => 1);
    vi.resetModules();
    const again = await import('@/lib/authority');
    expect(again.cancellerNames()).toEqual(['shared']);
  });
});
