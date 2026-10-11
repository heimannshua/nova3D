// Story 1.4d. What the preference Server Action (app/account/preference-actions.ts) answers, and how the provider
// reads a call that did not answer. Kept apart from the action so the client component imports nothing from the
// server, like lib/session-actions.ts, whose reading of a redirect this shares.
import {unstable_rethrow} from 'next/navigation';
import {withDeadline} from './deadline';
import {reloadHere, unexpectedResponseMessage} from './session-actions';

/** `saved`: the record holds the choice. `unavailable`: it could not be saved (nothing was stored). */
export type PreferenceSaveState = {outcome: 'saved'} | {outcome: 'unavailable'};

export type PreferenceSaveAction = (name: string, value: string | null) => Promise<PreferenceSaveState>;

/**
 * How long the browser waits for the save action before it gives up and undoes the choice: a few seconds more than
 * the server's own budget for an action (`actionTimeoutMs` in lib/access.ts, 8 seconds; a test keeps the two in
 * step), so the server's answer, `unavailable` or not, is what normally arrives. A save the server finishes after
 * the browser gave up is simply there on the next page load.
 */
export const preferenceSaveTimeoutMs = 12_000;

/**
 * `saved` and `unavailable` are the action's own answers. `ended` is the one that is not: this session no longer has
 * access (it was signed out in another tab, its grant was revoked, the Account was disabled), so the proxy answered
 * the action with a redirect to an HTML page, which the client sees as "an unexpected response", or the action itself
 * redirected. The page is loaded again (or Next is already following the redirect) so the proxy can send the person
 * to sign in; there is no choice left to undo.
 */
export type PreferenceSaveResult = 'saved' | 'unavailable' | 'ended';

/**
 * Calls the save action and reads what comes back. Never throws, except to let Next.js follow a redirect the action
 * itself made (an Account that is not active is sent where any private request is sent). A dropped connection, a real
 * server error or no answer within `timeoutMs` is `unavailable`: the action did not complete and nothing is known to
 * be stored, so the choice is undone and the person may try again. At most one reload per attempt, so it can never
 * become a reload loop.
 */
export async function attemptPreferenceSave(
  action: PreferenceSaveAction,
  name: string,
  value: string | null,
  navigate: () => void = reloadHere,
  timeoutMs: number = preferenceSaveTimeoutMs,
): Promise<PreferenceSaveResult> {
  try {
    const state = await withDeadline(action(name, value), timeoutMs);
    return state?.outcome === 'saved' ? 'saved' : 'unavailable';
  } catch (error) {
    unstable_rethrow(error);
    if (error instanceof Error && error.message === unexpectedResponseMessage) {
      navigate();
      return 'ended';
    }
    return 'unavailable';
  }
}

export type PreferenceSaveHandlers = {
  /** Called at once, when the save is put in line. */
  queued?: () => void;
  /** Called exactly once for every save, after it has finished, with how many saves are still in line behind it. */
  settled: (result: PreferenceSaveResult, remaining: number) => void;
};

export type PreferenceSaveQueue = {
  /** How many saves are in line or running. */
  pending: () => number;
  /** Puts a save in line behind the ones before it. */
  enqueue: (change: {name: string; value: string | null}, handlers: PreferenceSaveHandlers) => void;
};

/**
 * Saves, one after another, in the order the choices were made. The line cannot be broken or stopped: whatever a
 * save does, `settled` is called once for it with the count already brought back down, and the next save runs.
 *
 *   - A save that throws is `ended`, not a failure of the line. The only thing `attemptPreferenceSave` lets through
 *     is a Next.js redirect (`unstable_rethrow`), and Next is already following it, so there is nothing to undo.
 *   - A save that never answers is cut off by `attemptPreferenceSave`'s own deadline, so it cannot hold the line.
 *   - A handler that throws is ignored: it cannot stop the saves behind it.
 *
 * `save` is a parameter (the provider passes `attemptPreferenceSave` over the Server Action), so the order, the
 * counters, the deadline and the redirect can be tested with fake timers.
 */
export function createPreferenceSaveQueue(save: (name: string, value: string | null) => Promise<PreferenceSaveResult>): PreferenceSaveQueue {
  let line: Promise<void> = Promise.resolve();
  let pending = 0;
  return {
    pending: () => pending,
    enqueue(change, handlers) {
      pending += 1;
      try {
        handlers.queued?.();
      } catch {
        // A handler's failure is its own.
      }
      line = line
        .then(async () => {
          let result: PreferenceSaveResult;
          try {
            result = await save(change.name, change.value);
          } catch {
            result = 'ended';
          } finally {
            pending -= 1;
          }
          try {
            handlers.settled(result, pending);
          } catch {
            // A handler's failure is its own.
          }
        })
        .catch(() => undefined);
    },
  };
}
