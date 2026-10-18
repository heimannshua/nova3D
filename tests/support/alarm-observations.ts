import type {Observations} from '@/lib/alarm-conditions';
import {scheduleRegistry} from '@/lib/schedules';

/**
 * Observations in which every condition of the registry finds something to report: every task (the monitor too) finished its last run long ago, the ledger holds a
 * stale backlog behind a relay that is running, more Auth identities than the limit have no Account, and the heartbeat and the receipts are far older than two hours.
 * A test that wants the keys the conditions put in their details, or a card for each of them, evaluates the real registry against this.
 */
export function everythingWrong(): Observations {
  const at = '2026-10-17T08:00:00.000Z';
  return {
    firstReceiptAge: 400_000,
    latestReceiptAge: 100_000,
    firstHeartbeatAge: 400_000,
    latestHeartbeatAge: 100_000,
    ledgerWaiting: 7,
    ledgerOldest: 5_000,
    unaccounted: 40,
    tasks: scheduleRegistry.map((entry) => ({task: entry.task, outcome: 'ran' as const, at, age: 100_000})),
    heartbeatConfigured: true,
  };
}
