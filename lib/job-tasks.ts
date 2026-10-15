// Story 1.9. The tasks a schedule fires (lib/schedules.ts lists them; lib/jobs.ts verifies the call, claims the run and calls `runTask`).
// Each task is idempotent: two messages for one slot (QStash documents no scheduled-time header, so the claim's key is the schedule ID and
// message ID) both run to completion without harm.
//
//   ledger-relay           ledgerPending() is 0: `idle`, and the store is not asked. Events are pending and no store is configured (the real
//                          adapter is Story 8.9's): `no_store`, and the pending count is recorded. Otherwise `relayLedger` runs ONCE, within
//                          one lease and at most 50 events, and its report is the result, a store outage included (the change is in force,
//                          the events stay pending, the next firing resumes). A report of `conflict` or `corrupt` is not a result: the
//                          chain in the store is damaged, so the run FAILS (LedgerConflictError or LedgerCorruptError, recorded by class
//                          name only) and the scheduler retries it, instead of recording a run that did what it was for.
//   dormant-identity-purge api.purge_dormant_identities(100): the counts are the result.
//
// A task returns its outcome and a result of counts, booleans and single words (lib/lifecycle.ts `isJobResult`): the receipt holds nothing
// else. A task that throws is a `failed` run, and the route records the error's CLASS NAME only, never its message.
//
// SERVER-ONLY (it imports lib/lifecycle.ts). Erasable TypeScript syntax and relative `.ts` imports, like the modules it serves.
import type {AccountsOptions} from './accounts.ts';
import {relayLedger, type LedgerStore} from './ledger.ts';
import {isJobResult, ledgerPending, purgeDormantIdentities, type JobOutcome, type JobResult} from './lifecycle.ts';
import type {ScheduledTask} from './schedules.ts';

/** How many events one firing of the relay copies at most, and how long it holds the relay's lease. One firing is one lease. */
export const relayBatchLimit = 50;
export const relayLeaseSeconds = 30;
/** How many identities one firing of the purge examines at most. */
export const purgeBatchLimit = 100;

/**
 * The relay found the ledger store's chain damaged: another writer created the next object first with different bytes (`conflict`), or what the
 * store holds does not chain (`corrupt`). Nothing was appended past the damage and the events stay pending. These are thrown, not returned, so the
 * receipt says `failed` with the class name and the route answers 500; the message holds no key, ID or event.
 */
export class LedgerConflictError extends Error {
  constructor() {
    super('the ledger store holds an object where the relay would append another');
    this.name = 'LedgerConflictError';
  }
}
export class LedgerCorruptError extends Error {
  constructor() {
    super('the ledger store holds objects that do not form the chain');
    this.name = 'LedgerCorruptError';
  }
}

/** What a task answers: how the run went (never `failed`: a task that cannot finish throws) and what it counted. */
export type TaskResult = {outcome: Exclude<JobOutcome, 'failed'>; result: JobResult};

export type TaskContext = {
  /** The environment's `INSTANCE_ID`: the prefix of every ledger key. */
  instanceId: string;
  /** The database calls' options (the environment, a fetch, a deadline). */
  accounts?: AccountsOptions;
  /**
   * The ledger store. Left out, the configured one is used (`configuredLedgerStore`: none until Story 8.9, so the relay answers `no_store`).
   * The tests pass the fixture store, or `null` for none.
   */
  ledgerStore?: LedgerStore | null;
};

/**
 * The ledger store this environment is configured with, or null. Story 8.9 supplies the Backblaze adapter and this is where it is
 * constructed from the environment; until then there is no real store, and the in-memory fixture (lib/ledger-fixture.ts) is for the
 * tests alone, so a deployment with events pending answers `no_store` and the events wait.
 */
export function configuredLedgerStore(): LedgerStore | null {
  return null;
}

async function ledgerRelayTask(context: TaskContext): Promise<TaskResult> {
  const accounts = context.accounts ?? {};
  const backlog = await ledgerPending(accounts);
  if (backlog.pending === 0) return {outcome: 'idle', result: {pending: 0}};
  const store = context.ledgerStore === undefined ? configuredLedgerStore() : context.ledgerStore;
  if (store === null) return {outcome: 'no_store', result: {pending: backlog.pending}};
  const report = await relayLedger({store, instanceId: context.instanceId, limit: relayBatchLimit, leaseSeconds: relayLeaseSeconds, accounts});
  // A store that is down or a relay that is busy is the next firing's to resume (the change stays in force, the events stay pending). A damaged
  // chain is not: it will be damaged on the next firing too, so the run is a failure the scheduler retries and the alarm of Story 1.13 can see.
  if (report.outcome === 'conflict') throw new LedgerConflictError();
  if (report.outcome === 'corrupt') throw new LedgerCorruptError();
  return {outcome: 'ran', result: {outcome: report.outcome, claimed: report.claimed, appended: report.appended, marked: report.marked}};
}

async function dormantIdentityPurgeTask(context: TaskContext): Promise<TaskResult> {
  const report = await purgeDormantIdentities({limit: purgeBatchLimit}, context.accounts ?? {});
  return {outcome: 'ran', result: {deleted: report.deleted, kept: report.kept, locked: report.locked, remaining: report.remaining}};
}

/** Every registered task, by ID. A task added to lib/schedules.ts must be added here: the compiler and a test both insist. */
export const tasks: Record<ScheduledTask, (context: TaskContext) => Promise<TaskResult>> = {
  'ledger-relay': ledgerRelayTask,
  'dormant-identity-purge': dormantIdentityPurgeTask,
};

/**
 * Runs a registered task. It throws when the task cannot finish (the database did not answer, an answer was not an answer) and when a
 * task answers something a receipt could not hold; the caller records a `failed` receipt with the error's class.
 */
export async function runTask(task: ScheduledTask, context: TaskContext): Promise<TaskResult> {
  const answer = await tasks[task](context);
  if (!isJobResult(answer.result)) throw new TypeError('a task answered a result a receipt cannot hold');
  return answer;
}
