// A promise that gives up. Everything that waits on Auth or the database while deciding access uses it, so
// a hung service ends in the fail-closed answer instead of a hung request. No imports: the proxy, the
// callback, the sign-out helpers and the tests all share it.

/**
 * Settles like `work`, or rejects after `milliseconds`. The timer is always cleared. The work itself is not
 * cancelled (a fetch keeps running until its own timeout), but nothing waits for it.
 */
export function withDeadline<T>(work: Promise<T>, milliseconds: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => reject(new Error(`no answer within ${milliseconds} ms`)), milliseconds);
  });
  return Promise.race([work, deadline]).finally(() => clearTimeout(timer));
}
