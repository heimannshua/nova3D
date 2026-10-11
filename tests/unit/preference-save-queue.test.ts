import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';
import {actionTimeoutMs} from '@/lib/access';
import {attemptPreferenceSave, createPreferenceSaveQueue, preferenceSaveTimeoutMs, type PreferenceSaveAction, type PreferenceSaveResult} from '@/lib/preference-actions';
import {unexpectedResponseMessage} from '@/lib/session-actions';

// The line that saves a signed-in person's choices (Story 1.4d), with fake timers and a fake Server Action: the
// order the saves run in, the counters coming back to zero whatever a save does, a save that hangs, a redirect
// thrown through it, and a failure followed by a success. The line must never break: a save that throws used to
// leave the counters up, every later save skipped and an unhandled rejection behind.
class Redirected extends Error {
  // The marker Next.js gives a redirect it throws, so unstable_rethrow lets it through.
  readonly digest = 'NEXT_REDIRECT;replace;/login;307;';
}

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

type Event = {name: string; result: PreferenceSaveResult; remaining: number};

/** A line over the real `attemptPreferenceSave` and a scripted action; every settled save is recorded, and the unhandled rejections are watched. */
function harness(script: (name: string, value: string | null, call: number) => Promise<{outcome: 'saved' | 'unavailable'}>) {
  const calls: string[] = [];
  const events: Event[] = [];
  const queuedAt: number[] = [];
  const navigate = vi.fn();
  const action: PreferenceSaveAction = (name, value) => {
    calls.push(`${name}=${value}`);
    return script(name, value, calls.length);
  };
  const queue = createPreferenceSaveQueue((name, value) => attemptPreferenceSave(action, name, value, navigate));
  const add = (name: string, value: string | null) =>
    queue.enqueue({name, value}, {queued: () => queuedAt.push(queue.pending()), settled: (result, remaining) => events.push({name, result, remaining})});
  return {queue, add, calls, events, queuedAt, navigate};
}

const rejections: unknown[] = [];
const watch = (reason: unknown) => rejections.push(reason);
beforeEach(() => {
  rejections.length = 0;
  process.on('unhandledRejection', watch);
});
afterEach(() => {
  process.off('unhandledRejection', watch);
});
const flush = async () => {
  await vi.advanceTimersByTimeAsync(0);
};

describe('the order and the counters', () => {
  it('runs the saves one at a time, in the order the choices were made, whatever order they would finish in', async () => {
    const finish: Record<string, () => void> = {};
    const { add, calls, events, queue } = harness((name) => new Promise((resolve) => { finish[name] = () => resolve({outcome: 'saved'}); }));
    add('theme', 'dark');
    add('locale', 'he');
    add('detail', 'technical');
    await flush();
    // Only the first is out; the others wait their turn.
    expect(calls).toEqual(['theme=dark']);
    expect(queue.pending()).toBe(3);
    finish.theme();
    await flush();
    expect(calls).toEqual(['theme=dark', 'locale=he']);
    finish.locale();
    await flush();
    finish.detail();
    await flush();
    expect(calls).toEqual(['theme=dark', 'locale=he', 'detail=technical']);
    expect(events).toEqual([
      {name: 'theme', result: 'saved', remaining: 2},
      {name: 'locale', result: 'saved', remaining: 1},
      {name: 'detail', result: 'saved', remaining: 0},
    ]);
    expect(queue.pending()).toBe(0);
  });

  it('counts a save from the moment it is put in line, and tells its handler when', async () => {
    const { add, queuedAt } = harness(async () => ({outcome: 'saved'}));
    add('theme', 'dark');
    add('detail', 'technical');
    expect(queuedAt).toEqual([1, 2]);
    await flush();
  });

  it('passes a null language through as null', async () => {
    const { add, calls } = harness(async () => ({outcome: 'saved'}));
    add('locale', null);
    await flush();
    expect(calls).toEqual(['locale=null']);
  });
});

describe('whatever a save does, the line goes on and every count comes back to zero', () => {
  it('a save that throws a Next.js redirect is "ended", leaves nothing waiting, and the saves behind it still run', async () => {
    const { add, calls, events, queue, navigate } = harness(async (_name, _value, call) => {
      if (call === 1) throw new Redirected('NEXT_REDIRECT');
      return {outcome: 'saved'};
    });
    add('theme', 'dark');
    add('detail', 'technical');
    await flush();
    expect(events).toEqual([
      {name: 'theme', result: 'ended', remaining: 1},
      {name: 'detail', result: 'saved', remaining: 0},
    ]);
    expect(calls).toEqual(['theme=dark', 'detail=technical']);
    expect(queue.pending()).toBe(0);
    // Next follows a redirect by itself; the page is not loaded again on top of it.
    expect(navigate).not.toHaveBeenCalled();
    expect(rejections).toEqual([]);
  });

  it('the proxy\'s redirect (an unexpected response) is "ended" and loads the page again once', async () => {
    const { add, events, queue, navigate } = harness(async () => { throw new Error(unexpectedResponseMessage); });
    add('theme', 'dark');
    await flush();
    expect(events).toEqual([{name: 'theme', result: 'ended', remaining: 0}]);
    expect(navigate).toHaveBeenCalledTimes(1);
    expect(queue.pending()).toBe(0);
  });

  it('a save that never answers is cut off at the client deadline, counts as "unavailable", and releases the line', async () => {
    const { add, calls, events, queue } = harness(async (_name, _value, call) => (call === 1 ? new Promise(() => undefined) : {outcome: 'saved'}));
    add('theme', 'dark');
    add('detail', 'technical');
    await vi.advanceTimersByTimeAsync(preferenceSaveTimeoutMs - 1);
    expect(events).toEqual([]);
    expect(calls).toEqual(['theme=dark']);
    expect(queue.pending()).toBe(2);
    await vi.advanceTimersByTimeAsync(1);
    expect(events).toEqual([
      {name: 'theme', result: 'unavailable', remaining: 1},
      {name: 'detail', result: 'saved', remaining: 0},
    ]);
    expect(calls).toEqual(['theme=dark', 'detail=technical']);
    expect(queue.pending()).toBe(0);
    expect(rejections).toEqual([]);
  });

  it('a hung save that is answered with a redirect after the deadline is not an unhandled rejection', async () => {
    let fail!: (error: Error) => void;
    const { add, events } = harness(() => new Promise((_resolve, reject) => { fail = reject; }));
    add('theme', 'dark');
    await vi.advanceTimersByTimeAsync(preferenceSaveTimeoutMs);
    expect(events).toEqual([{name: 'theme', result: 'unavailable', remaining: 0}]);
    fail(new Redirected('NEXT_REDIRECT'));
    await flush();
    expect(rejections).toEqual([]);
  });

  it('a failure followed by a success: the failure is reported, the success is saved, and both are counted down', async () => {
    const { add, events, queue } = harness(async (_name, _value, call) => (call === 1 ? {outcome: 'unavailable'} : {outcome: 'saved'}));
    add('theme', 'dark');
    add('theme', 'light');
    await flush();
    expect(events).toEqual([
      {name: 'theme', result: 'unavailable', remaining: 1},
      {name: 'theme', result: 'saved', remaining: 0},
    ]);
    expect(queue.pending()).toBe(0);
  });

  it('a dropped connection is a failure, not the end of the line', async () => {
    const { add, events, queue } = harness(async (_name, _value, call) => {
      if (call === 1) throw new TypeError('Failed to fetch');
      return {outcome: 'saved'};
    });
    add('theme', 'dark');
    add('theme', 'light');
    await flush();
    expect(events.map((event) => event.result)).toEqual(['unavailable', 'saved']);
    expect(queue.pending()).toBe(0);
  });

  it('a handler that throws cannot stop the saves behind it or leave the count up', async () => {
    const calls: string[] = [];
    const settled: string[] = [];
    const queue = createPreferenceSaveQueue(async (name) => {
      calls.push(name);
      return 'saved';
    });
    queue.enqueue({name: 'theme', value: 'dark'}, {queued: () => { throw new Error('boom'); }, settled: () => { throw new Error('boom'); }});
    queue.enqueue({name: 'detail', value: 'technical'}, {settled: (result) => settled.push(result)});
    await flush();
    expect(calls).toEqual(['theme', 'detail']);
    expect(settled).toEqual(['saved']);
    expect(queue.pending()).toBe(0);
    expect(rejections).toEqual([]);
  });

  it('a save function that itself throws is "ended", never an unhandled rejection', async () => {
    const events: string[] = [];
    const queue = createPreferenceSaveQueue(async () => { throw new Error('nobody catches this'); });
    queue.enqueue({name: 'theme', value: 'dark'}, {settled: (result, remaining) => events.push(`${result}:${remaining}`)});
    queue.enqueue({name: 'theme', value: 'light'}, {settled: (result, remaining) => events.push(`${result}:${remaining}`)});
    await flush();
    expect(events).toEqual(['ended:1', 'ended:0']);
    expect(queue.pending()).toBe(0);
    expect(rejections).toEqual([]);
  });

  it('keeps working after many failures: the line is never left rejected', async () => {
    const { add, events, queue } = harness(async (_name, _value, call) => {
      if (call % 2 === 1) throw new Redirected('NEXT_REDIRECT');
      return {outcome: 'saved'};
    });
    for (let index = 0; index < 8; index += 1) add('detail', index % 2 ? 'simple' : 'technical');
    await flush();
    expect(events.map((event) => event.result)).toEqual(['ended', 'saved', 'ended', 'saved', 'ended', 'saved', 'ended', 'saved']);
    expect(queue.pending()).toBe(0);
  });
});

describe('the client deadline', () => {
  it('is a few seconds above the server\'s budget for an action, so the server\'s own answer normally arrives first', () => {
    expect(preferenceSaveTimeoutMs).toBeGreaterThan(actionTimeoutMs);
    expect(preferenceSaveTimeoutMs - actionTimeoutMs).toBeLessThanOrEqual(5000);
    expect(preferenceSaveTimeoutMs - actionTimeoutMs).toBeGreaterThanOrEqual(2000);
  });

  it('can be set per call, and an answer in time is not cut off', async () => {
    const slow: PreferenceSaveAction = () => new Promise((resolve) => setTimeout(() => resolve({outcome: 'saved'}), 500));
    const pending = attemptPreferenceSave(slow, 'theme', 'dark', vi.fn(), 1000);
    await vi.advanceTimersByTimeAsync(500);
    expect(await pending).toBe('saved');
    const tooSlow = attemptPreferenceSave(slow, 'theme', 'dark', vi.fn(), 100);
    await vi.advanceTimersByTimeAsync(100);
    expect(await tooSlow).toBe('unavailable');
  });
});
