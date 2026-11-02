// Story 2.7. The canceller of Jobs: when an Account is disabled, the cancellation signals that follow the disable (lib/authority.ts `runCancellers`, called by the Accounts page's
// action once `api.disable_account` has COMMITTED) reach the Account's Jobs here. The authority is already gone by then, so a running Job cannot publish anything: this ends the
// leases (commit authority first), cancels the open attempts `account_disabled`, releases what never went out, keeps what was dispatched held, and records ONE audit event,
// `jobs.cancelled`. It returns how many attempts it cancelled; the Accounts page shows the number.
//
// It is best effort and safe to run twice (the second finds nothing). Cancellers live in one process, so it is not the only layer: the minute sweep (lib/job-dispatch.ts
// `runOutboxSweep`) cancels any open attempt whose Account is disabled or whose epoch moved, so a disable whose canceller did not run is finished by the next sweep.
//
// instrumentation.ts imports this module for the Node runtime, which registers the canceller once per process (a second evaluation of the module registers nothing).
//
// SERVER-ONLY (it imports lib/job-commands.ts, which imports lib/accounts.ts). Erasable TypeScript syntax and relative `.ts` imports, like the modules it serves.
import {cancellerNames, registerCanceller} from './authority.ts';
import {cancelAccountJobs} from './job-commands.ts';

/** The name the canceller is registered under. */
export const jobCancellerName = 'jobs';

/** Registers the canceller of Jobs, once. Returns the function that removes it (a no-op when it was already registered). */
export function registerJobCanceller(): () => void {
  if (cancellerNames().includes(jobCancellerName)) return () => undefined;
  return registerCanceller({
    name: jobCancellerName,
    cancel: async ({accountId}) => (await cancelAccountJobs({accountId})).cancelled,
  });
}

registerJobCanceller();
