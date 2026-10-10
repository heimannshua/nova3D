import {describe, expect, it, vi} from 'vitest';
import {withDeadline} from '@/lib/deadline';

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
