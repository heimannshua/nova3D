import {describe, expect, it, vi} from 'vitest';
import {createBudget, withDeadline, withinBudget} from '@/lib/deadline';

describe('withDeadline', () => {
  it('settles like the work when it is quick, and leaves no timer behind', async () => {
    vi.useFakeTimers();
    try {
      await expect(withDeadline(Promise.resolve('done'), 1000)).resolves.toBe('done');
      await expect(withDeadline(Promise.reject(new Error('failed')), 1000)).rejects.toThrow('failed');
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it('rejects when the work never settles, and says how long it waited', async () => {
    vi.useFakeTimers();
    try {
      const pending = withDeadline(new Promise(() => undefined), 250);
      const outcome = expect(pending).rejects.toThrow('no answer within 250 ms');
      await vi.advanceTimersByTimeAsync(250);
      await outcome;
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it('does not raise an unhandled rejection when the abandoned work fails later', async () => {
    vi.useFakeTimers();
    const unhandled = vi.fn();
    process.on('unhandledRejection', unhandled);
    try {
      let fail: (error: Error) => void = () => undefined;
      const late = new Promise((_resolve, reject) => { fail = reject; });
      const pending = withDeadline(late, 100);
      const outcome = expect(pending).rejects.toThrow('no answer');
      await vi.advanceTimersByTimeAsync(100);
      await outcome;
      fail(new Error('too late'));
      await vi.advanceTimersByTimeAsync(10);
      expect(unhandled).not.toHaveBeenCalled();
    } finally {
      process.off('unhandledRejection', unhandled);
      vi.useRealTimers();
    }
  });
});

describe('createBudget and withinBudget', () => {
  it('counts down from the moment it is made, and never goes below zero', () => {
    vi.useFakeTimers();
    try {
      const budget = createBudget(1000);
      expect(budget.remaining()).toBe(1000);
      vi.advanceTimersByTime(400);
      expect(budget.remaining()).toBe(600);
      vi.advanceTimersByTime(5000);
      expect(budget.remaining()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it('tells each step how much is left, and settles like the step when it is quick', async () => {
    vi.useFakeTimers();
    try {
      const budget = createBudget(1000);
      const told: number[] = [];
      expect(await withinBudget(budget, async (left) => { told.push(left); return 'a'; })).toBe('a');
      await vi.advanceTimersByTimeAsync(300);
      expect(await withinBudget(budget, async (left) => { told.push(left); return 'b'; })).toBe('b');
      expect(told).toEqual([1000, 700]);
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it('starts no step when no time is left, and says why', async () => {
    vi.useFakeTimers();
    try {
      const budget = createBudget(500);
      vi.advanceTimersByTime(500);
      const step = vi.fn(async () => 'never');
      await expect(withinBudget(budget, step)).rejects.toThrow('no time left in the budget');
      expect(step).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it('gives up on a step that outlasts the budget, at the budget and not before or after', async () => {
    vi.useFakeTimers();
    try {
      const budget = createBudget(1000);
      await vi.advanceTimersByTimeAsync(250);
      const pending = withinBudget(budget, () => new Promise(() => undefined));
      const outcome = expect(pending).rejects.toThrow('no answer within 750 ms');
      await vi.advanceTimersByTimeAsync(749);
      let settled = false;
      void pending.catch(() => (settled = true));
      await vi.advanceTimersByTimeAsync(0);
      expect(settled).toBe(false);
      await vi.advanceTimersByTimeAsync(1);
      await outcome;
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });
});
