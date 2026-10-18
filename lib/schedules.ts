// Story 1.9. The schedule registry: every periodic task of the application, with the cron expression QStash fires it on.
//
// This file has NO imports on purpose, so the route (lib/jobs.ts), the tasks (lib/job-tasks.ts), the operator's command
// (scripts/schedules.mjs, through Node type stripping) and the tests all read the one list. Erasable TypeScript syntax only.
//
// A schedule is one entry here and one QStash schedule per entry, calling POST `<origin>/api/jobs` with the body
// {"task": <task>, "instance": <INSTANCE_ID>}. `node scripts/schedules.mjs check` compares the live schedules with this list and
// `apply` makes them equal; an operator runs both, never CI. Every cron expression is in UTC (QStash's default; none names a zone).
//
// Story 1.12 added the staging cleanup (hourly). Story 1.13 gives every entry an `intervalSeconds` (how often the cron expression fires it, in seconds:
// plain data, which the alarm condition `task-late` reads: a task whose latest finished receipt is older than twice its interval is late) and adds the
// monitor itself, `alarm-monitor`, the task that evaluates the alarm conditions. Later stories add their tasks HERE and in lib/job-tasks.ts, and nowhere else:
//   Story 2.7  the outbox sweep with lease and deadline expiry (every minute)
//   Story 8.3  purge deadlines (hourly)
//   Story 8.9  the backup monitor (every 30 minutes)
// The cleanups this story leaves deferred (session grants, step-up nonces, recovery tokens, outbox retention) are not registered.

/** The one path a schedule calls. lib/public-paths.ts names it as the machine path. */
export const jobsPath = '/api/jobs';

export const scheduleRegistry = [
  {
    task: 'dormant-identity-purge',
    // Daily at 03:00 UTC.
    cron: '0 3 * * *',
    intervalSeconds: 86400,
    description: 'Deletes Auth identities that never became Accounts and have been idle for 30 days, under the lock registration takes first.',
  },
  {
    task: 'ledger-relay',
    // Every five minutes, UTC.
    cron: '*/5 * * * *',
    intervalSeconds: 300,
    description: 'Copies pending ledger events to the ledger store, in order, within one lease (at most 50 events). Idle when nothing is pending.',
  },
  {
    task: 'staging-cleanup',
    // Every hour, on the hour, UTC.
    cron: '0 * * * *',
    intervalSeconds: 3600,
    description: 'Removes the staging of expired or released upload leases through the file gateway, one signed delete command each (at most 50); a lease renewed meanwhile is kept.',
  },
  {
    task: 'alarm-monitor',
    // Every five minutes, UTC.
    cron: '*/5 * * * *',
    intervalSeconds: 300,
    description: 'Evaluates the operational alarm conditions: raises an alarm for each finding, resolves the ones that cleared, and emails the Administrator the alarms that are due (Story 1.13).',
  },
] as const;

/** The monitor: the task that evaluates the alarm conditions. It cannot report on itself, so the condition `task-late` leaves it out. */
export const monitorTask = 'alarm-monitor';

export type ScheduleEntry = (typeof scheduleRegistry)[number];
/** The ID of a registered task. */
export type ScheduledTask = ScheduleEntry['task'];

export const scheduledTasks: readonly ScheduledTask[] = scheduleRegistry.map((entry) => entry.task);

/** Whether a value is the ID of a registered task. Own entries only: `constructor` and `__proto__` are not tasks. */
export function isScheduledTask(value: unknown): value is ScheduledTask {
  return typeof value === 'string' && (scheduledTasks as readonly string[]).includes(value);
}

/** The body a schedule sends: exactly the task and the instance it is for, as compact JSON. */
export function scheduleBody(task: ScheduledTask, instanceId: string): string {
  return JSON.stringify({task, instance: instanceId});
}
