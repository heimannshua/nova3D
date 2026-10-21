import {randomUUID} from 'node:crypto';
import type {Client} from 'pg';

// Story 2.6. Real Usage ledger rows made as the table OWNER, bypassing admission, so a test (or a browser test) can put a period into the state it needs: "10M settled
// and 2M reserved" is a reservation of 2M that nothing has settled and a reservation of 10M that a settlement has settled. Replaces the owner-written stand-in
// `usage.fixture_figures` of Story 2.4, which Story 2.6 dropped. The owner writes the ledgers directly here; the application and the `api` functions never do except
// through api.reserve_cost and api.settle_cost.
//
// Every row is a real one: a Project of the Account, a Job, its running attempt, a step, an operation, then the reservation and the settlement. A reservation with no schedule
// of its own pins a fixture schedule made with it (see insertReservation). It is cleaned up with the Account (tests/support/accounts-data.ts, tests/support/forged-session.ts
// and scripts/seed-projects.mjs delete the ledgers before the Jobs and the periods, and the cleanups delete the fixture schedules no reservation uses).

export type LedgerIds = {jobId: string; reservationIds: string[]; settlementIds: string[]; operationIds: string[]};

/** The Account's live Project, or a new one for the ledger rows to hang on (a Job names a Project). */
async function projectOf(client: Client, accountId: string): Promise<string> {
  const found = await client.query('select id from projects.projects where account_id = $1 and deleted_at is null order by created_at limit 1', [accountId]);
  if (found.rows.length) return found.rows[0].id as string;
  const workspace = await client.query('select id from projects.workspaces where account_id = $1', [accountId]);
  if (!workspace.rows.length) throw new Error('The Account has no Workspace, so it cannot hold a Project for the ledger rows.');
  const made = await client.query(
    `insert into projects.projects (workspace_id, account_id, title, stage) values ($1, $2, 'Usage ledger fixture', 'request_draft') returning id`,
    [workspace.rows[0].id, accountId],
  );
  return made.rows[0].id as string;
}

/** A Job of the Account with a running attempt 1, one step and `operations` planned operations, inserted directly. Returns the Job, the attempt, the step and the operations. */
export async function ledgerJob(client: Client, accountId: string, operations = 1, projectId?: string) {
  const project = projectId ?? (await projectOf(client, accountId));
  const job = (await client.query(`insert into jobs.jobs (account_id, project_id, kind) values ($1, $2, 'ledger') returning id`, [accountId, project])).rows[0].id as string;
  const attempt = (
    await client.query(
      `insert into jobs.attempts (account_id, job_id, number, input_digest, state, stage) values ($1, $2, 1, repeat('a', 64), 'waiting', 'accepted') returning id`,
      [accountId, job],
    )
  ).rows[0].id as string;
  await client.query(`update jobs.attempts set state = 'running', stage = 'started', started_at = clock_timestamp() where id = $1`, [attempt]);
  const step = (await client.query(`insert into jobs.steps (account_id, attempt_id, step_key) values ($1, $2, 'ledger') returning id`, [accountId, attempt])).rows[0].id as string;
  const operationIds: string[] = [];
  for (let ordinal = 1; ordinal <= operations; ordinal += 1) {
    operationIds.push(
      (await client.query(`insert into jobs.operations (account_id, step_id, ordinal, state) values ($1, $2, $3, 'planned') returning id`, [accountId, step, ordinal])).rows[0].id as string,
    );
  }
  return {jobId: job, attemptId: attempt, stepId: step, operationIds};
}

/**
 * A reservation of the given amount in the given period, for the given operation, inserted directly (admission is bypassed: no cap or allowance is judged). It pins
 * `scheduleId` when one is given (a schedule the test made and removes). Without one, it makes a fixture rate schedule of its own, in the SAME STATEMENT as the
 * reservation that pins it: the cleanups (tests/support/accounts-data.ts, tests/support/forged-session.ts) delete the fixture schedules no reservation uses, and a schedule
 * shared between parallel files, or made in one statement and used in the next, could be deleted in between (23503). A schedule that is born pinned cannot be.
 */
export async function insertReservation(
  client: Client,
  spec: {accountId: string; periodId: string; jobId: string; operationId: string; amount: number; scheduleId?: string; provider?: string; model?: string; apiVersion?: string; digest?: string},
): Promise<string> {
  const digest = spec.digest ?? randomUUID().replaceAll('-', '').repeat(2);
  if (spec.scheduleId) {
    const pins = (await client.query('select provider, model, api_version from usage.rate_schedules where id = $1', [spec.scheduleId])).rows[0];
    const {rows} = await client.query(
      `insert into usage.reservations (account_id, period_id, job_id, operation_id, rate_schedule_id, provider, requested_model, api_version, request_bytes, image_count, output_limit,
                                       input_bound, reserved_microdollars, digest)
       values ($1, $2, $3, $4, $5, $6, $7, $8, 0, 0, 0, usage.input_bound(0, 0), $9, $10) returning id`,
      [spec.accountId, spec.periodId, spec.jobId, spec.operationId, spec.scheduleId, spec.provider ?? pins.provider, spec.model ?? pins.model, spec.apiVersion ?? pins.api_version, spec.amount, digest],
    );
    return rows[0].id as string;
  }
  if (spec.provider || spec.model || spec.apiVersion) throw new Error('The pins of a reservation are those of its schedule: give the schedule to change them.');
  const {rows} = await client.query(
    `with pinned as (
       insert into usage.rate_schedules (provider, model, version, api_version, currency, input_rate_num, input_rate_den, output_rate_num, output_rate_den, request_rate_num, request_rate_den,
                                         input_increment, output_increment, multiplier_num, multiplier_den)
       values ('fixture', $1, 1, 'fixture-1', 'USD', 1, 1, 1, 1, 0, 1, 1, 1, 1, 1)
       returning id, provider, model, api_version
     )
     insert into usage.reservations (account_id, period_id, job_id, operation_id, rate_schedule_id, provider, requested_model, api_version, request_bytes, image_count, output_limit,
                                     input_bound, reserved_microdollars, digest)
     select $2::uuid, $3::uuid, $4::uuid, $5::uuid, pinned.id, pinned.provider, pinned.model, pinned.api_version, 0, 0, 0, usage.input_bound(0, 0), $6::bigint, $7::text from pinned
     returning id`,
    [`ledger-${randomUUID().replaceAll('-', '')}`, spec.accountId, spec.periodId, spec.jobId, spec.operationId, spec.amount, digest],
  );
  return rows[0].id as string;
}

/** A settlement of the given reservation, in the given period, inserted directly. A `deadline` settles the whole reservation; the amount given is for `evidence`. */
export async function insertSettlement(
  client: Client,
  spec: {accountId: string; reservationId: string; periodId: string; classification?: 'evidence' | 'deadline' | 'noncharge' | 'unused'; settled?: number},
): Promise<string> {
  const classification = spec.classification ?? 'deadline';
  const reserved = Number((await client.query('select reserved_microdollars::float8 as amount from usage.reservations where id = $1', [spec.reservationId])).rows[0].amount);
  const settled = classification === 'deadline' ? reserved : classification === 'evidence' ? (spec.settled ?? reserved) : 0;
  const {rows} = await client.query(
    `insert into usage.settlements (account_id, reservation_id, period_id, classification, settled_microdollars, released_microdollars, input_tokens, output_tokens, returned_model, digest)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) returning id`,
    [
      spec.accountId, spec.reservationId, spec.periodId, classification, settled, reserved,
      classification === 'evidence' ? 1 : null, classification === 'evidence' ? 1 : null, classification === 'evidence' ? 'fixture-ledger' : null,
      randomUUID().replaceAll('-', '').repeat(2),
    ],
  );
  return rows[0].id as string;
}

/** An overrun incident for a reservation whose settlement exceeded it, inserted directly (the guard trigger judges that it is what it says). */
export async function insertIncident(client: Client, spec: {accountId: string; reservationId: string; settlementId: string}): Promise<string> {
  const {rows} = await client.query(
    `insert into usage.overrun_incidents (account_id, reservation_id, settlement_id, provider, reserved_microdollars, evidence_microdollars)
     select r.account_id, r.id, s.id, r.provider, r.reserved_microdollars, s.settled_microdollars
       from usage.reservations r join usage.settlements s on s.reservation_id = r.id
      where r.id = $1 and s.id = $2 and r.account_id = $3
     returning id`,
    [spec.reservationId, spec.settlementId, spec.accountId],
  );
  return rows[0].id as string;
}

/**
 * Puts a period into a state: `settled` microdollars settled in it and `reserved` still reserved in it, as real ledger rows made by the owner. A period's figures are the
 * ledgers' (usage.period_figures), so the shown settled is the period's carried settled plus `settled` and the shown reserved its carried reserved plus `reserved`.
 * Call it once for a period and an Account; a second call adds more. Nothing is written for an amount of 0.
 */
export async function setFigures(client: Client, periodId: string, settled: number, reserved: number): Promise<LedgerIds> {
  const period = await client.query('select account_id from usage.periods where id = $1', [periodId]);
  if (!period.rows.length) throw new Error('No such period.');
  const accountId = period.rows[0].account_id as string;
  const ids: LedgerIds = {jobId: '', reservationIds: [], settlementIds: [], operationIds: []};
  if (settled === 0 && reserved === 0) return ids;
  const job = await ledgerJob(client, accountId, 2);
  ids.jobId = job.jobId;
  ids.operationIds = job.operationIds;
  if (settled > 0) {
    const reservation = await insertReservation(client, {accountId, periodId, jobId: job.jobId, operationId: job.operationIds[0], amount: settled});
    ids.reservationIds.push(reservation);
    ids.settlementIds.push(await insertSettlement(client, {accountId, reservationId: reservation, periodId, classification: 'deadline'}));
  }
  if (reserved > 0) ids.reservationIds.push(await insertReservation(client, {accountId, periodId, jobId: job.jobId, operationId: job.operationIds[1], amount: reserved}));
  return ids;
}

/** Deletes every ledger row of the Account in the order they restrict one another (incidents, settlements, reservations, receipts), as the cleanup does. */
export async function removeLedger(client: Client, accountId: string) {
  await client.query('delete from usage.overrun_incidents where account_id = $1', [accountId]);
  await client.query('delete from usage.settlements where account_id = $1', [accountId]);
  await client.query('delete from usage.reservations where account_id = $1', [accountId]);
  await client.query('delete from usage.commands where account_id = $1', [accountId]);
}
