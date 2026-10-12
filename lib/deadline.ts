// A promise that gives up. Everything that waits on Auth or the database while deciding access uses it, so
// a hung service ends in the fail-closed answer instead of a hung request. No imports: the proxy, the
// callback, the sign-out helpers and the tests all share it.

/**
 * What `withDeadline` rejects with when the work did not settle in time. The work HAD been started (a caller that must know
 * whether a call may have reached its destination, Administrator recovery's transaction, tells this apart from a step that was
 * never started: `withinBudget` rejects with a plain Error when none of the budget is left). The message is the same as ever.
 */
export class DeadlineError extends Error {
  constructor(milliseconds: number) {
    super(`no answer within ${milliseconds} ms`);
    this.name = 'DeadlineError';
  }
}

/**
 * Settles like `work`, or rejects after `milliseconds`. The timer is always cleared. The work itself is not
 * cancelled (a fetch keeps running until its own timeout), but nothing waits for it.
 */
export function withDeadline<T>(work: Promise<T>, milliseconds: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => reject(new DeadlineError(milliseconds)), milliseconds);
  });
  return Promise.race([work, deadline]).finally(() => clearTimeout(timer));
}

/** One overall allowance of time for a chain of calls, so three slow calls cannot take three times as long. */
export type Budget = {
  /** Milliseconds left, never below zero. */
  remaining(): number;
};

/** A budget of `milliseconds`, counted from now. */
export function createBudget(milliseconds: number): Budget {
  const end = Date.now() + milliseconds;
  return {remaining: () => Math.max(0, end - Date.now())};
}

/**
 * Runs one step of a chain inside its budget. `step` is told how many milliseconds are left (so it can hand
 * the same limit to the network call it makes) and is not started at all when none are. Settles like the step,
 * or rejects when the budget runs out first.
 */
export function withinBudget<T>(budget: Budget, step: (remainingMs: number) => Promise<T>): Promise<T> {
  const remaining = budget.remaining();
  if (remaining <= 0) return Promise.reject(new Error('no time left in the budget'));
  return withDeadline(step(remaining), remaining);
}
