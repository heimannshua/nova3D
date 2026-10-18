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
//   staging-cleanup        Story 1.12. With no gateway configured (lib/gateway-client.ts `configuredGatewayClient`: the application's keys and the gateway's
//                          address) the run is `no_store` and nothing is read or deleted. Otherwise api.list_expired_staging(50) names the leases that are
//                          expired or released: none is `idle`; each is one signed `delete-staging` command to the gateway, which checks AGAIN, in one
//                          statement, that the lease is still expired or released and deletes only that upload's exact prefix (a lease renewed meanwhile is
//                          `kept`). The result is counts only. A gateway that is down or refuses a command FAILS the run (the class of the error is recorded)
//                          and the scheduler retries it: the list is read afresh and the commands are idempotent.
//
//   alarm-monitor         Story 1.13. Evaluates the registry of alarm conditions (lib/alarm-conditions.ts) against the observations the database reports
//                         (lib/alarms.ts `runAlarmMonitor`): raises an alarm for each finding, resolves the open alarms of its conditions that cleared, and
//                         emails the Administrator what is due. The result is counts only: `raised`, `resolved`, `mailed`, `mail_failed`. A condition that
//                         cannot be evaluated, or an alarm that cannot be written, FAILS the run (after the rest was done) and the scheduler retries it.
//
// A task returns its outcome and a result of counts, booleans and single words (lib/lifecycle.ts `isJobResult`): the receipt holds nothing
// else. A task that throws is a `failed` run, and the route records the error's CLASS NAME only, never its message.
//
// SERVER-ONLY (it imports lib/lifecycle.ts). Erasable TypeScript syntax and relative `.ts` imports, like the modules it serves.
import type {AccountsOptions} from './accounts.ts';
import {runAlarmMonitor, type MonitorDeps} from './alarms.ts';
import {configuredGatewayClient, GatewayError, GatewayUnavailableError, type GatewayClient} from './gateway-client.ts';
import {relayLedger, type LedgerStore} from './ledger.ts';
import {isJobResult, ledgerPending, listExpiredStaging, purgeDormantIdentities, type JobOutcome, type JobResult} from './lifecycle.ts';
import type {ScheduledTask} from './schedules.ts';

/** How many events one firing of the relay copies at most, and how long it holds the relay's lease. One firing is one lease. */
export const relayBatchLimit = 50;
export const relayLeaseSeconds = 30;
/** How many identities one firing of the purge examines at most. */
export const purgeBatchLimit = 100;
/** How many expired leases one firing of the staging cleanup removes at most. */
export const stagingCleanupLimit = 50;

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

/**
 * The staging cleanup could not clean every lease it listed (the gateway refused a command for one or more of them). Thrown, not returned, so the receipt
 * says `failed` with this class name only and the scheduler retries; the message holds no ID.
 */
export class StagingCleanupIncompleteError extends Error {
  constructor() {
    super('the staging cleanup left some expired leases uncleaned');
    this.name = 'StagingCleanupIncompleteError';
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
  /**
   * The file gateway's client (Story 1.12). Left out, the configured one is used (`configuredGatewayClient`: none unless the application's signing keys and
   * the gateway's address are set, so the cleanup answers `no_store`). The tests pass a fake, or `null` for none.
   */
  gateway?: GatewayClient | null;
  /**
   * The alarm monitor's injections (Story 1.13): the mail sender, the registry of conditions, the schedules they look at, whether the heartbeat is configured.
   * Left out, the registered conditions and the real sender are used. The tests pass a fixture condition and a fake sender.
   */
  alarms?: Omit<MonitorDeps, 'accounts'>;
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

async function stagingCleanupTask(context: TaskContext): Promise<TaskResult> {
  const gateway = context.gateway === undefined ? configuredGatewayClient() : context.gateway;
  // No gateway to delete through: nothing is read and nothing is deleted. The leases wait, and so does the work.
  if (gateway === null) return {outcome: 'no_store', result: {configured: false}};
  const leases = await listExpiredStaging({limit: stagingCleanupLimit}, context.accounts ?? {});
  if (leases.length === 0) return {outcome: 'idle', result: {expired: 0}};
  let deleted = 0;
  let kept = 0;
  let failed = 0;
  // One at a time, and each on its own. A gateway that cannot be reached (or says it is unavailable) stops the loop and fails the run: the rest would fail the
  // same way, and fifty attempts at a gateway that is down help nobody. Anything else that goes wrong is THIS lease's: it is counted and the loop goes on, so
  // one lease the gateway refuses cannot keep the leases behind it from ever being cleaned.
  for (const lease of leases) {
    try {
      const answer = await gateway.deleteStaging({accountId: lease.accountId, uploadId: lease.uploadId});
      if (answer.outcome === 'deleted') deleted += 1;
      else kept += 1;
    } catch (error) {
      if (error instanceof GatewayUnavailableError || (error instanceof GatewayError && error.status >= 500)) throw error;
      failed += 1;
    }
  }
  // A lease that could not be cleaned makes the run a failure (the receipt records the error's class, and the scheduler retries it): the lease is still
  // listed the next time, and the commands are idempotent.
  if (failed > 0) throw new StagingCleanupIncompleteError();
  return {outcome: 'ran', result: {expired: leases.length, deleted, kept}};
}

async function alarmMonitorTask(context: TaskContext): Promise<TaskResult> {
  const report = await runAlarmMonitor({...context.alarms, accounts: context.accounts ?? {}});
  return {outcome: 'ran', result: {raised: report.raised, resolved: report.resolved, mailed: report.mailed, mail_failed: report.mailFailed}};
}

/** Every registered task, by ID. A task added to lib/schedules.ts must be added here: the compiler and a test both insist. */
export const tasks: Record<ScheduledTask, (context: TaskContext) => Promise<TaskResult>> = {
  'ledger-relay': ledgerRelayTask,
  'dormant-identity-purge': dormantIdentityPurgeTask,
  'staging-cleanup': stagingCleanupTask,
  'alarm-monitor': alarmMonitorTask,
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
