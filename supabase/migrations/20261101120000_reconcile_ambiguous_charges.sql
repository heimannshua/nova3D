-- Story 2.8: reconcile ambiguous charges without replacement calls.
--
-- An operation that was sent but whose outcome is unknown (a timeout, a 5xx, a lost connection, an aborted stream, a lost lease) kept its full reservation for ever: nothing
-- moved a `dispatched` operation to `ambiguous` (so its 24-hour clock never started), nothing settled it at the deadline, a later usage report could not correct a deadline
-- booking, an overrun incident could not be seen or cleared (so a provider stayed blocked for every Account), and nothing raised an alarm. Known defects rode along: one
-- operation that could not settle aborted the whole sweep, a period total could pass the 10^15 microdollar bound at settlement, and a returned model was never compared with
-- the reserved one.
--
--   usage.corrections             the append-only correction ledger: ONE row for each reservation (unique) that was settled at the deadline and then got usage evidence. It
--                                 carries the signed settled delta (evidence minus reserved), the evidence, the model and the period. A settlement is never edited; a
--                                 correction is how a booking changes. Update and truncate are refused.
--   usage.overrun_incidents       gains `correction_id`: evidence above the reservation that arrived AFTER a deadline booking opens its incident on the original settlement.
--   usage.period_figures          re-created: the settled figure counts the corrections (never below what the period carries); usage.job_exposure counts them too.
--   api.settle_cost               re-created: `evidence` needs the returned model to be the reservation's pinned one (`invalid_evidence`); a settlement that would take
--                                 the period's settled total over 10^15 answers `overflow` and writes nothing; evidence after a `deadline` settlement appends ONE correction
--                                 (`corrected`; the same evidence again `replayed`, other evidence `already_settled`).
--   jobs.mark_ambiguous           authority-free move of a `dispatched` operation to `ambiguous` (starts the 24-hour clock): internal, no API role.
--   api.sweep_attempts            re-created: after lease expiry it marks the `dispatched` operations of ended attempts `ambiguous` and settles each due `ambiguous`
--                                 operation once at its reservation (class `deadline`), then moves it to `settled`. Each operation runs in its own sub-block.
--   jobs.settle_abandoned         re-created with the same isolation: one operation that cannot settle no longer aborts the others, or a cancel.
--   api.finish_operation          re-created: also takes `ambiguous` (fenced, request ID optional); a refused report answers a word and never raises 55000.
--   api.reconcile_operation       late evidence or a proven noncharge for an `ambiguous` operation, or late evidence after a deadline booking (a correction).
--   api.list_overrun_incidents, api.clear_overrun_incident   the Administrator's list and clearing of overrun incidents across Accounts.
--   api.record_usage_refusal      re-created: accepts `usage.incident_refused`.
--   api.alarm_observations        re-created: also reports `unknown_cost_oldest`.
--   api.preflight                 re-created carrying every earlier probe and the new ones (seventy-two `api` functions in all).
--
-- LOCKS, in one order: the global lock `nova3d:jobs-sweep` first for the sweep; then every Job lock the sweep needs (in all its stages that take none of the Usage locks), then the
-- operation rows FOR UPDATE, and only then the Usage locks (`nova3d:usage-command:...`, `nova3d:usage:<account>`), so a command that holds one Job lock and waits for a Usage lock
-- can never be waited for by the sweep. Everywhere else: the Job lock, then the operation row, then the Usage locks.
--
-- Stable error codes: 22023 (arguments), 55000 (a record refuses a change), 23514 (a row is not shaped as the ledger requires), N3020 (a migration is missing).

-- The recorded constant --------------------------------------------------------------------------------------------------------------------

-- An unsettled operation of unknown cost raises the alarm over 24 hours (usage.ambiguity_deadline) plus 10 minutes of sweep slack: 87,000 seconds. lib/alarm-conditions.ts mirrors it as
-- `unknownCostSeconds`, and a test holds the two equal.
create function usage.unknown_cost_alarm_seconds() returns integer language sql immutable set search_path = '' as $$ select 87000 $$;

comment on function usage.unknown_cost_alarm_seconds() is 'How old an operation of unknown cost (dispatched or ambiguous, reserved, unsettled) may be before the unknown-cost alarm rises: 24 hours plus 10 minutes of sweep slack, 87,000 seconds. A recorded constant. Callable by no API role.';

-- The corrections --------------------------------------------------------------------------------------------------------------------------

create table usage.corrections (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references identity.accounts (id) on delete restrict,
  -- ONE correction for each reservation: the evidence that arrived after a deadline booking.
  reservation_id uuid not null,
  -- The deadline settlement it corrects. That row is never edited.
  settlement_id uuid not null,
  -- The period the correction was made in: the current one at that moment.
  period_id uuid not null,
  -- Signed: the evidence priced by the calculator minus the amount the deadline settled (the whole reservation). Negative releases the difference, positive settles the excess.
  settled_delta_microdollars bigint not null check (settled_delta_microdollars between -1000000000000000 and 1000000000000000),
  input_tokens bigint not null check (input_tokens >= 0),
  output_tokens bigint not null check (output_tokens >= 0),
  returned_model text not null check (returned_model ~ '^[!-~]{1,200}$'),
  digest text not null check (digest ~ '^[0-9a-f]{64}$'),
  created_at timestamptz not null default clock_timestamp(),
  constraint corrections_reservation_fkey foreign key (reservation_id, account_id) references usage.reservations (id, account_id) on delete restrict,
  constraint corrections_settlement_fkey foreign key (settlement_id, account_id) references usage.settlements (id, account_id) on delete restrict,
  constraint corrections_period_fkey foreign key (period_id, account_id) references usage.periods (id, account_id) on delete restrict,
  constraint corrections_reservation_key unique (reservation_id),
  constraint corrections_id_account_key unique (id, account_id)
);

comment on table usage.corrections is
  'The append-only correction ledger (Story 2.8): one row for a reservation that was settled at its deadline and then got usage evidence. Signed settled delta (evidence minus reserved), the evidence, the model and the period. The settlement it corrects is never edited. Update and truncate are refused; delete is left for the Epic 8 purge.';

create index corrections_period_idx on usage.corrections (period_id);

-- A correction corrects a DEADLINE settlement of its reservation, in the period of that settlement or a later one, and the evidence it carries is not below nothing.
create function usage.check_correction() returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_reservation usage.reservations;
  v_settlement usage.settlements;
  v_settlement_seq integer;
  v_seq integer;
begin
  select * into v_reservation from usage.reservations r where r.id = new.reservation_id and r.account_id = new.account_id;
  select * into v_settlement from usage.settlements s where s.id = new.settlement_id and s.account_id = new.account_id;
  if v_reservation.id is null or v_settlement.id is null or v_settlement.reservation_id <> v_reservation.id or v_settlement.classification <> 'deadline' then
    raise exception 'usage.corrections: a correction is of the deadline settlement of its reservation' using errcode = '23514';
  end if;
  if v_reservation.reserved_microdollars + new.settled_delta_microdollars < 0 or v_reservation.reserved_microdollars + new.settled_delta_microdollars > 1000000000000000 then
    raise exception 'usage.corrections: the corrected amount is from 0 to 1e15' using errcode = '23514';
  end if;
  select p.seq into v_settlement_seq from usage.periods p where p.id = v_settlement.period_id;
  select p.seq into v_seq from usage.periods p where p.id = new.period_id;
  if v_seq < v_settlement_seq then
    raise exception 'usage.corrections: a correction is not in a period before its settlement''s' using errcode = '23514';
  end if;
  return new;
end;
$$;

comment on function usage.check_correction() is 'Checks a correction against its reservation and its deadline settlement. Callable by no API role.';

create trigger corrections_check before insert on usage.corrections
  for each row execute function usage.check_correction();
create trigger corrections_no_update before update on usage.corrections
  for each row execute function usage.refuse_record_change();
create trigger corrections_no_truncate before truncate on usage.corrections
  for each statement execute function usage.refuse_record_change();

alter table usage.corrections enable row level security;
revoke all on usage.corrections from public, anon, authenticated, service_role;

-- The incident of evidence that arrived after the deadline ---------------------------------------------------------------------------------

-- Evidence above the reservation normally opens its incident on the evidence settlement. When the evidence arrives AFTER a deadline booking, the settlement is the deadline one (it is
-- never edited) and the incident names the correction that carries the evidence.
alter table usage.overrun_incidents add column correction_id uuid;
alter table usage.overrun_incidents add constraint overrun_incidents_correction_fkey
  foreign key (correction_id, account_id) references usage.corrections (id, account_id) on delete restrict;
alter table usage.overrun_incidents add constraint overrun_incidents_correction_key unique (correction_id);

create or replace function usage.check_incident() returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_reservation usage.reservations;
  v_settlement usage.settlements;
  v_correction usage.corrections;
begin
  select * into v_reservation from usage.reservations r where r.id = new.reservation_id and r.account_id = new.account_id;
  select * into v_settlement from usage.settlements s where s.id = new.settlement_id and s.account_id = new.account_id;
  if new.correction_id is null then
    if v_reservation.id is null or v_settlement.id is null or v_settlement.reservation_id <> v_reservation.id
       or v_settlement.classification <> 'evidence'
       or new.provider <> v_reservation.provider
       or new.reserved_microdollars <> v_reservation.reserved_microdollars
       or new.evidence_microdollars <> v_settlement.settled_microdollars then
      raise exception 'usage.overrun_incidents: an incident is the evidence settlement that exceeded its reservation' using errcode = '23514';
    end if;
  else
    select * into v_correction from usage.corrections c where c.id = new.correction_id and c.account_id = new.account_id;
    if v_reservation.id is null or v_settlement.id is null or v_correction.id is null or v_settlement.reservation_id <> v_reservation.id
       or v_settlement.classification <> 'deadline'
       or v_correction.reservation_id <> v_reservation.id or v_correction.settlement_id <> v_settlement.id
       or new.provider <> v_reservation.provider
       or new.reserved_microdollars <> v_reservation.reserved_microdollars
       or new.evidence_microdollars <> v_reservation.reserved_microdollars + v_correction.settled_delta_microdollars then
      raise exception 'usage.overrun_incidents: an incident is the evidence, after a deadline booking, that exceeded its reservation' using errcode = '23514';
    end if;
  end if;
  if new.cleared_at is not null then
    raise exception 'usage.overrun_incidents: an incident begins uncleared' using errcode = '23514';
  end if;
  return new;
end;
$$;

create or replace function usage.guard_incident_change() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if old.cleared_at is not null then
    raise exception 'usage.overrun_incidents: a cleared incident is not changed' using errcode = '55000';
  end if;
  if new.cleared_at is null or new.cleared_by is null then
    raise exception 'usage.overrun_incidents: only the clearing changes an incident' using errcode = '55000';
  end if;
  if new.id is distinct from old.id or new.account_id is distinct from old.account_id or new.reservation_id is distinct from old.reservation_id
     or new.settlement_id is distinct from old.settlement_id or new.correction_id is distinct from old.correction_id or new.provider is distinct from old.provider
     or new.reserved_microdollars is distinct from old.reserved_microdollars or new.evidence_microdollars is distinct from old.evidence_microdollars
     or new.created_at is distinct from old.created_at then
    raise exception 'usage.overrun_incidents: only the clearing changes an incident' using errcode = '55000';
  end if;
  return new;
end;
$$;

-- The figures and the Job's exposure -------------------------------------------------------------------------------------------------------

-- The settled figure OF the period now also counts the corrections made in it (signed). It is never below what the period carried in (negated): the count of a month or of a reset
-- starts at 0, and a correction that releases a booking of an earlier month cannot take it below nothing. So `carried + figure` is always from 0 to 1e15, and every reader that adds
-- the two (the shown amounts, the headroom, the carry of a successor period) stays correct without a change.
create or replace function usage.period_figures(p_period_id uuid)
returns table (settled_microdollars bigint, reserved_microdollars bigint)
language sql
stable
set search_path = ''
as $$
  select greatest(
           coalesce((select sum(s.settled_microdollars) from usage.settlements s where s.period_id = p_period_id), 0)
           + coalesce((select sum(c.settled_delta_microdollars) from usage.corrections c where c.period_id = p_period_id), 0),
           -coalesce((select p.carried_settled_microdollars from usage.periods p where p.id = p_period_id), 0)
         )::bigint,
         (coalesce((select sum(r.reserved_microdollars) from usage.reservations r where r.period_id = p_period_id), 0)
          - coalesce((select sum(s.released_microdollars) from usage.settlements s where s.period_id = p_period_id), 0))::bigint
$$;

comment on function usage.period_figures(uuid) is
  'The settled and reserved figures of one period, the only way they are read: signed deltas from the reservation, settlement and correction ledgers (the settled one never below what the period carried in). Callable by no API role.';

-- The Job's exposure counts a correction too: the settled amount where settled, plus the signed correction, and the reserved amount where not.
create or replace function usage.job_exposure(p_job_id uuid) returns bigint
language sql
stable
set search_path = ''
as $$
  select coalesce(sum(coalesce(s.settled_microdollars, r.reserved_microdollars) + coalesce(c.settled_delta_microdollars, 0)), 0)::bigint
    from usage.reservations r
    left join usage.settlements s on s.reservation_id = r.id
    left join usage.corrections c on c.reservation_id = r.id
   where r.job_id = p_job_id
$$;

comment on function usage.job_exposure(uuid) is
  'The exposure of a Job across all its attempts: the settled amount of each reservation that is settled (and its signed correction) and the reserved amount of each that is not. Callable by no API role.';

-- The command: settle (re-created) ----------------------------------------------------------------------------------------------------------

-- Two more attributes: the correction a `corrected` (or a replayed correction) carries, and its signed delta. Everything else is as Story 2.6 left it, plus the outcome `overflow`.
alter type api.cost_settlement add attribute correction_id uuid;
alter type api.cost_settlement add attribute delta_microdollars bigint;

create or replace function api.settle_cost(
  p_account_id uuid, p_command_id uuid, p_operation_id uuid, p_classification text,
  p_input_tokens bigint default null, p_output_tokens bigint default null, p_returned_model text default null
) returns api.cost_settlement
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_result api.cost_settlement;
  v_digest text;
  v_command usage.commands;
  v_operation jobs.operations;
  v_reservation usage.reservations;
  v_settlement usage.settlements;
  v_correction usage.corrections;
  v_period usage.periods;
  v_priced record;
  v_figure bigint;
  v_settled bigint;
  v_delta bigint;
  v_correcting boolean := false;
  v_due timestamptz;
  v_incident_id uuid;
begin
  -- 1. The arguments: the evidence fields come with `evidence` and with nothing else.
  if p_account_id is null or p_command_id is null or p_operation_id is null
     or p_classification is null or p_classification not in ('evidence', 'deadline', 'noncharge', 'unused')
     or (p_classification = 'evidence' and (p_input_tokens is null or p_output_tokens is null or p_returned_model is null))
     or (p_classification <> 'evidence' and (p_input_tokens is not null or p_output_tokens is not null or p_returned_model is not null))
     or (p_input_tokens is not null and p_input_tokens < 0)
     or (p_output_tokens is not null and p_output_tokens < 0)
     or (p_returned_model is not null and p_returned_model !~ '^[!-~]{1,200}$') then
    raise exception 'invalid argument' using errcode = '22023';
  end if;

  -- 2. One command ID at a time for an Account. There is NO check of the Account's epoch or status, and none of its Project: settling records what already
  -- happened or releases what never went out, and refusing it for a disabled, stale or tombstoned Account would strand the money.
  perform pg_advisory_xact_lock(hashtextextended('nova3d:usage-command:' || p_account_id::text || ':' || p_command_id::text, 0));

  -- 3. The operation belongs to the Account (`unavailable` for a foreign or unknown one). Its row is held FOR SHARE, so its state is the one the settlement is judged by.
  select * into v_operation from jobs.operations o where o.id = p_operation_id and o.account_id = p_account_id for share;
  if not found then
    v_result.outcome := 'unavailable';
    return v_result;
  end if;

  -- 4. One settler at a time for an Account, and the month turns when work is first asked for.
  perform pg_advisory_xact_lock(hashtextextended('nova3d:usage:' || p_account_id::text, 0));
  v_period := usage.ensure_period(p_account_id);

  -- 5. The receipt. Its subject is the settlement, or the correction a late evidence made.
  v_digest := usage.cost_digest('settle_cost', array[p_operation_id::text, p_classification, p_input_tokens::text, p_output_tokens::text, p_returned_model]);
  select * into v_command from usage.commands c where c.account_id = p_account_id and c.command_id = p_command_id;
  if found then
    if v_command.kind <> 'settle' or v_command.digest <> v_digest then
      v_result.outcome := 'reused';
      return v_result;
    end if;
    select * into v_settlement from usage.settlements s where s.id = v_command.subject_id;
    if not found then
      select * into v_correction from usage.corrections c where c.id = v_command.subject_id;
      -- A receipt names the settlement or the correction it made or found. If that row is gone the ledger no longer agrees with its receipts, and that is not an answer to give.
      if not found then
        raise exception 'usage.commands: receipt subject missing' using errcode = '55000';
      end if;
      select * into v_settlement from usage.settlements s where s.id = v_correction.settlement_id;
      v_result.outcome := 'replayed';
      v_result.correction_id := v_correction.id;
      v_result.delta_microdollars := v_correction.settled_delta_microdollars;
      v_result.over_microdollars := greatest(v_correction.settled_delta_microdollars, 0);
      select i.id into v_result.incident_id from usage.overrun_incidents i where i.correction_id = v_correction.id;
    else
      v_result.outcome := 'replayed';
      v_result.over_microdollars := greatest(v_settlement.settled_microdollars - v_settlement.released_microdollars, 0);
      select i.id into v_result.incident_id from usage.overrun_incidents i where i.settlement_id = v_settlement.id;
    end if;
    v_result.settlement_id := v_settlement.id;
    v_result.reservation_id := v_settlement.reservation_id;
    v_result.operation_id := p_operation_id;
    v_result.period_id := v_settlement.period_id;
    v_result.classification := v_settlement.classification;
    v_result.settled_microdollars := v_settlement.settled_microdollars;
    v_result.released_microdollars := v_settlement.released_microdollars;
    return v_result;
  end if;

  -- 6. The operation holds no reservation.
  select * into v_reservation from usage.reservations r where r.operation_id = p_operation_id;
  if not found then
    v_result.outcome := 'not_reserved';
    return v_result;
  end if;

  -- 7. Already settled: the same classification and evidence replays (recorded under this ID too), another is refused. Settling is once. EVIDENCE after a DEADLINE booking is the
  -- one thing that still lands: it appends a correction (below), once.
  select * into v_settlement from usage.settlements s where s.reservation_id = v_reservation.id;
  if found then
    v_result.settlement_id := v_settlement.id;
    v_result.reservation_id := v_settlement.reservation_id;
    v_result.operation_id := p_operation_id;
    v_result.period_id := v_settlement.period_id;
    v_result.classification := v_settlement.classification;
    v_result.settled_microdollars := v_settlement.settled_microdollars;
    v_result.released_microdollars := v_settlement.released_microdollars;
    v_result.over_microdollars := greatest(v_settlement.settled_microdollars - v_settlement.released_microdollars, 0);
    select i.id into v_result.incident_id from usage.overrun_incidents i where i.settlement_id = v_settlement.id;
    if p_classification = 'evidence' and v_settlement.classification = 'deadline' then
      select * into v_correction from usage.corrections c where c.reservation_id = v_reservation.id;
      if found then
        v_result.correction_id := v_correction.id;
        v_result.delta_microdollars := v_correction.settled_delta_microdollars;
        v_result.over_microdollars := greatest(v_correction.settled_delta_microdollars, 0);
        select i.id into v_result.incident_id from usage.overrun_incidents i where i.correction_id = v_correction.id;
        if v_correction.digest = v_digest then
          perform usage.record_command(p_account_id, p_command_id, 'settle', v_digest, v_correction.id);
          v_result.outcome := 'replayed';
        else
          v_result.outcome := 'already_settled';
        end if;
        return v_result;
      end if;
      v_correcting := true;
    else
      if v_settlement.digest = v_digest then
        perform usage.record_command(p_account_id, p_command_id, 'settle', v_digest, v_settlement.id);
        v_result.outcome := 'replayed';
      else
        v_result.outcome := 'already_settled';
      end if;
      return v_result;
    end if;
  end if;

  -- 8. The operation's state has to fit the class.
  if not (case p_classification
            when 'evidence' then v_operation.state in ('completed', 'ambiguous', 'settled')
            when 'deadline' then v_operation.state in ('ambiguous', 'settled')
            when 'noncharge' then v_operation.state = 'noncharge'
            else v_operation.state = 'abandoned'
          end) then
    v_result := null;
    v_result.outcome := 'not_settleable';
    v_result.state := v_operation.state;
    return v_result;
  end if;

  -- 9. A deadline settlement is due 24 hours after the outcome was recorded.
  if p_classification = 'deadline' then
    v_due := v_operation.outcome_at + usage.ambiguity_deadline();
    if clock_timestamp() < v_due then
      v_result.outcome := 'not_due';
      v_result.due_at := v_due;
      return v_result;
    end if;
  end if;

  -- 10. What is settled: the evidence priced by the calculator at the pinned schedule (the model it names has to be the one the reservation pinned), the reservation itself, or nothing.
  if p_classification = 'evidence' then
    if p_returned_model <> v_reservation.requested_model then
      v_result := null;
      v_result.outcome := 'invalid_evidence';
      v_result.reason := 'model_mismatch';
      return v_result;
    end if;
    select * into v_priced from usage.price(v_reservation.rate_schedule_id, p_input_tokens::numeric, p_output_tokens::numeric, 1);
    if v_priced.microdollars > 1000000000000000 then
      v_result := null;
      v_result.outcome := 'invalid_evidence';
      v_result.reason := 'overflow';
      return v_result;
    end if;
    v_settled := v_priced.microdollars::bigint;
  elsif p_classification = 'deadline' then
    v_settled := v_reservation.reserved_microdollars;
  else
    v_settled := 0;
  end if;

  -- The period's settled total (what it carried in, its figure and this amount) stays within the bound; otherwise nothing is written and the operation stays unsettled.
  select f.settled_microdollars into v_figure from usage.period_figures(v_period.id) f;
  v_delta := case when v_correcting then v_settled - v_reservation.reserved_microdollars else v_settled end;
  if v_delta > 0 and v_period.carried_settled_microdollars + v_figure + v_delta > 1000000000000000 then
    v_result := null;
    v_result.outcome := 'overflow';
    return v_result;
  end if;

  -- 11a. Evidence after a deadline booking: ONE correction (the settlement is not edited) and, when the evidence is above the reservation, one incident on the original settlement.
  if v_correcting then
    insert into usage.corrections (account_id, reservation_id, settlement_id, period_id, settled_delta_microdollars, input_tokens, output_tokens, returned_model, digest)
      values (p_account_id, v_reservation.id, v_settlement.id, v_period.id, v_delta, p_input_tokens, p_output_tokens, p_returned_model, v_digest)
      returning * into v_correction;
    if v_settled > v_reservation.reserved_microdollars then
      insert into usage.overrun_incidents (account_id, reservation_id, settlement_id, correction_id, provider, reserved_microdollars, evidence_microdollars)
        values (p_account_id, v_reservation.id, v_settlement.id, v_correction.id, v_reservation.provider, v_reservation.reserved_microdollars, v_settled)
        returning id into v_incident_id;
    end if;
    perform usage.record_command(p_account_id, p_command_id, 'settle', v_digest, v_correction.id);
    v_result := null;
    v_result.outcome := 'corrected';
    v_result.settlement_id := v_settlement.id;
    v_result.reservation_id := v_settlement.reservation_id;
    v_result.operation_id := p_operation_id;
    v_result.period_id := v_settlement.period_id;
    v_result.classification := v_settlement.classification;
    v_result.settled_microdollars := v_settlement.settled_microdollars;
    v_result.released_microdollars := v_settlement.released_microdollars;
    v_result.over_microdollars := greatest(v_delta, 0);
    v_result.incident_id := v_incident_id;
    v_result.correction_id := v_correction.id;
    v_result.delta_microdollars := v_delta;
    return v_result;
  end if;

  -- 11b. One settlement in the current period, and when the evidence exceeds the reservation also one incident, in the same transaction.
  insert into usage.settlements (
    account_id, reservation_id, period_id, classification, settled_microdollars, released_microdollars, input_tokens, output_tokens, returned_model, digest
  ) values (
    p_account_id, v_reservation.id, v_period.id, p_classification, v_settled, v_reservation.reserved_microdollars, p_input_tokens, p_output_tokens, p_returned_model, v_digest
  ) returning * into v_settlement;
  if v_settled > v_reservation.reserved_microdollars then
    insert into usage.overrun_incidents (account_id, reservation_id, settlement_id, provider, reserved_microdollars, evidence_microdollars)
      values (p_account_id, v_reservation.id, v_settlement.id, v_reservation.provider, v_reservation.reserved_microdollars, v_settled)
      returning id into v_incident_id;
  end if;
  perform usage.record_command(p_account_id, p_command_id, 'settle', v_digest, v_settlement.id);

  v_result := null;
  v_result.outcome := 'settled';
  v_result.settlement_id := v_settlement.id;
  v_result.reservation_id := v_settlement.reservation_id;
  v_result.operation_id := p_operation_id;
  v_result.period_id := v_settlement.period_id;
  v_result.classification := v_settlement.classification;
  v_result.settled_microdollars := v_settlement.settled_microdollars;
  v_result.released_microdollars := v_settlement.released_microdollars;
  v_result.over_microdollars := greatest(v_settlement.settled_microdollars - v_settlement.released_microdollars, 0);
  v_result.incident_id := v_incident_id;
  return v_result;
end;
$$;

comment on function api.settle_cost(uuid, uuid, uuid, text, bigint, bigint, text) is
  'Settles the reservation of an operation: evidence (priced by the calculator at the pinned schedule; the returned model has to be the pinned one), deadline (an ambiguous charge past 24 hours, at the reservation), noncharge or unused (at 0). Releases the whole reservation; evidence above it settles at the evidence and records an overrun incident. Evidence after a deadline booking appends ONE correction (the settlement is never edited): corrected. Account, command ID, typed payload; NO epoch, status or Project check, so a disable or a tombstone never strands the money. settled | corrected | replayed | reused | already_settled | not_reserved | not_settleable (carries the state) | not_due (carries the due time) | invalid_evidence (overflow, model_mismatch) | overflow (the period''s settled total would pass 1e15; nothing is written) | unavailable.';

-- jobs.mark_ambiguous: the authority-free move to `ambiguous` -------------------------------------------------------------------------------

-- Moves a `dispatched` operation to `ambiguous` and stamps `outcome_at` (once: the 24-hour clock starts here), under the Job's lock and with the operation's row held FOR UPDATE. No
-- authority is asked: the attempt may be gone, and the clock must start anyway. It answers whether it moved the operation (false: it is not `dispatched` any more, or there is none).
create function jobs.mark_ambiguous(p_operation_id uuid) returns boolean
language plpgsql
set search_path = ''
as $$
declare
  v_job_id uuid;
  v_operation jobs.operations;
begin
  select a.job_id into v_job_id
    from jobs.operations o
    join jobs.steps s on s.id = o.step_id
    join jobs.attempts a on a.id = s.attempt_id
   where o.id = p_operation_id;
  if not found then
    return false;
  end if;
  perform pg_advisory_xact_lock(hashtextextended('nova3d:job:' || v_job_id::text, 0));
  select * into v_operation from jobs.operations o where o.id = p_operation_id for update;
  if v_operation.state <> 'dispatched' then
    return false;
  end if;
  update jobs.operations o set state = 'ambiguous', outcome_at = clock_timestamp() where o.id = p_operation_id;
  return true;
end;
$$;

comment on function jobs.mark_ambiguous(uuid) is
  'Moves a dispatched operation to ambiguous with no authority check and stamps outcome_at, under the Job lock and the operation row FOR UPDATE. False when the operation is not dispatched. Callable by no API role.';

-- jobs.settle_abandoned: isolated -------------------------------------------------------------------------------------------------------------

-- Releases what never went out, one operation at a time, each in its own sub-block: an operation that cannot settle is counted `failed` and the others still settle. The sweep needs both
-- counts; jobs.settle_abandoned (below) keeps its signature and answers the settled one.
create function jobs.settle_abandoned_counted(p_attempt_id uuid, p_account_id uuid, p_limit integer, out settled integer, out failed integer)
language plpgsql
set search_path = ''
as $$
declare
  r record;
  v_result api.cost_settlement;
begin
  settled := 0;
  failed := 0;
  for r in
    select o.id as operation_id, o.account_id
      from jobs.operations o
      join jobs.steps s on s.id = o.step_id
      join usage.reservations rv on rv.operation_id = o.id
     where o.state = 'abandoned'
       and (p_attempt_id is null or s.attempt_id = p_attempt_id)
       and (p_account_id is null or o.account_id = p_account_id)
       and not exists (select 1 from usage.settlements st where st.reservation_id = rv.id)
     order by o.created_at, o.id
     limit p_limit
  loop
    begin
      v_result := api.settle_cost(r.account_id, jobs.derived_id('settle_unused', array[r.operation_id::text]), r.operation_id, 'unused');
      if v_result.outcome = 'settled' then
        settled := settled + 1;
      elsif v_result.outcome not in ('replayed', 'already_settled') then
        failed := failed + 1;
      end if;
    exception when others then
      failed := failed + 1;
    end;
  end loop;
end;
$$;

comment on function jobs.settle_abandoned_counted(uuid, uuid, integer) is
  'Settles `unused` every abandoned operation that holds a reservation and has no settlement, each in its own sub-block; returns how many settled and how many failed. Callable by no API role.';

create or replace function jobs.settle_abandoned(p_attempt_id uuid default null, p_account_id uuid default null, p_limit integer default 100) returns integer
language sql
set search_path = ''
as $$
  select c.settled from jobs.settle_abandoned_counted(p_attempt_id, p_account_id, p_limit) c
$$;

comment on function jobs.settle_abandoned(uuid, uuid, integer) is
  'Settles `unused` every abandoned operation that holds a reservation and has no settlement, releasing it; returns how many. One that cannot settle is skipped (the sweep counts it), never raised. Callable by no API role.';

-- api.finish_operation: also `ambiguous` ----------------------------------------------------------------------------------------------------

create or replace function api.finish_operation(
  p_attempt_id uuid, p_fence uuid, p_operation_id uuid, p_outcome text,
  p_input_tokens bigint default null, p_output_tokens bigint default null, p_returned_model text default null, p_request_id text default null
) returns api.dispatch_operation
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_result api.dispatch_operation;
  v_check jobs.fence_check;
  v_operation jobs.operations;
  v_advance api.operation_advance;
  v_settle api.cost_settlement;
  v_word text;
begin
  if p_attempt_id is null or p_fence is null or p_operation_id is null
     or p_outcome is null or p_outcome not in ('completed', 'noncharge', 'ambiguous')
     or (p_outcome = 'completed' and (p_input_tokens is null or p_input_tokens < 0 or p_output_tokens is null or p_output_tokens < 0
                                       or p_returned_model is null or p_returned_model !~ '^[!-~]{1,200}$' or p_request_id is not null))
     or (p_outcome = 'noncharge' and (p_request_id is null or p_request_id !~ '^[!-~]{1,200}$'
                                       or p_input_tokens is not null or p_output_tokens is not null or p_returned_model is not null))
     or (p_outcome = 'ambiguous' and (p_input_tokens is not null or p_output_tokens is not null or p_returned_model is not null
                                       or (p_request_id is not null and p_request_id !~ '^[!-~]{1,200}$'))) then
    raise exception 'invalid argument' using errcode = '22023';
  end if;
  v_check := jobs.check_fence(p_attempt_id, p_fence);
  if v_check.outcome <> 'ok' then
    v_result.outcome := v_check.outcome;
    return v_result;
  end if;

  -- The operation is one of this attempt's.
  select o.* into v_operation
    from jobs.operations o join jobs.steps s on s.id = o.step_id
   where o.id = p_operation_id and s.attempt_id = p_attempt_id;
  if not found then
    v_result.outcome := 'not_found';
    return v_result;
  end if;
  v_result.operation_id := v_operation.id;
  v_result.state := v_operation.state;
  if v_operation.state = 'planned' then
    v_result.outcome := 'not_dispatched';
    return v_result;
  end if;

  -- An ambiguous outcome only moves the operation: nothing is settled and the whole reservation stays held until evidence, a proven noncharge or the 24-hour deadline.
  if p_outcome = 'ambiguous' then
    v_advance := api.advance_operation(
      v_check.account_id, v_check.epoch, jobs.derived_id('finish', array[p_operation_id::text, p_outcome, p_request_id]), p_operation_id, 'ambiguous', p_request_id);
    v_result.state := v_advance.state;
    if v_advance.outcome not in ('advanced', 'replayed') then
      v_result.outcome := case v_advance.outcome when 'denied' then 'revoked' when 'unavailable' then 'unavailable' else 'invalid_transition' end;
      return v_result;
    end if;
    v_result.outcome := 'finished';
    return v_result;
  end if;

  -- The move, then the settlement, in one step: if the settlement cannot be made, the move is undone with it.
  begin
    v_advance := api.advance_operation(
      v_check.account_id, v_check.epoch, jobs.derived_id('finish', array[p_operation_id::text, p_outcome, p_request_id]), p_operation_id, p_outcome, p_request_id);
    if v_advance.outcome not in ('advanced', 'replayed') then
      v_result.outcome := case v_advance.outcome when 'denied' then 'revoked' when 'unavailable' then 'unavailable' else 'invalid_transition' end;
      v_result.state := v_advance.state;
      return v_result;
    end if;
    v_result.state := v_advance.state;
    if p_outcome = 'completed' then
      v_settle := api.settle_cost(
        v_check.account_id, jobs.derived_id('settle', array[p_operation_id::text, 'evidence']), p_operation_id, 'evidence', p_input_tokens, p_output_tokens, p_returned_model);
    else
      v_settle := api.settle_cost(v_check.account_id, jobs.derived_id('settle', array[p_operation_id::text, 'noncharge']), p_operation_id, 'noncharge');
    end if;
    -- A settlement that is refused undoes the move and answers a word (never an exception): the caller reports the operation `ambiguous` instead.
    if v_settle.outcome in ('already_settled', 'invalid_evidence', 'overflow') then
      raise exception using errcode = 'N3050', message = 'refused', detail = v_settle.outcome;
    end if;
    if v_settle.outcome not in ('settled', 'replayed', 'not_reserved') then
      raise exception using errcode = 'N3050', message = 'refused', detail = 'invalid_transition';
    end if;
  exception when sqlstate 'N3050' then
    get stacked diagnostics v_word = pg_exception_detail;
    v_result.outcome := v_word;
    v_result.state := v_operation.state;
    return v_result;
  end;
  v_result.outcome := 'finished';
  if v_settle.outcome <> 'not_reserved' then
    v_result.settled_microdollars := v_settle.settled_microdollars;
    v_result.released_microdollars := v_settle.released_microdollars;
    v_result.over_microdollars := v_settle.over_microdollars;
  end if;
  return v_result;
end;
$$;

comment on function api.finish_operation(uuid, uuid, uuid, text, bigint, bigint, text, text) is
  'Records the outcome of a dispatched operation of the attempt under its fence: completed moves the operation and settles it as evidence (priced by the calculator, the unused remainder released), noncharge (with the provider''s request ID) moves it and settles it noncharge, ambiguous (the request ID is optional) moves it to ambiguous, settles nothing and keeps the whole reservation held. A settlement that is refused undoes the move and answers a word, never an exception. finished | fence_mismatch | expired | cancelled | revoked | not_running | unavailable | not_found | not_dispatched | invalid_transition | already_settled | invalid_evidence | overflow.';

-- api.reconcile_operation ---------------------------------------------------------------------------------------------------------------------

-- outcome: reconciled | corrected | replayed | not_reconcilable | unavailable, or the settlement's refusal word (already_settled | invalid_evidence | overflow | not_reserved | not_settleable |
-- not_due | reused). The amounts and ids are those of the settlement or the correction; `state` is the operation's state after the command (for not_reconcilable, the state that refused).
create type api.operation_reconciliation as (
  outcome text,
  operation_id uuid,
  state text,
  reason text,
  settlement_id uuid,
  correction_id uuid,
  incident_id uuid,
  classification text,
  settled_microdollars bigint,
  released_microdollars bigint,
  over_microdollars bigint,
  delta_microdollars bigint
);

create function api.reconcile_operation(
  p_operation_id uuid, p_outcome text,
  p_input_tokens bigint default null, p_output_tokens bigint default null, p_returned_model text default null, p_request_id text default null
) returns api.operation_reconciliation
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_result api.operation_reconciliation;
  v_job_id uuid;
  v_operation jobs.operations;
  v_settle api.cost_settlement;
  v_command uuid;
  v_word text;
  v_reason text;
begin
  -- 1. The arguments. Authority-free: reconciling records what already happened (late evidence, a proven noncharge) and is never refused for a disabled, stale or removed Account.
  if p_operation_id is null or p_outcome is null or p_outcome not in ('evidence', 'noncharge')
     or (p_request_id is not null and p_request_id !~ '^[!-~]{1,200}$')
     or (p_outcome = 'evidence' and (p_input_tokens is null or p_input_tokens < 0 or p_output_tokens is null or p_output_tokens < 0
                                      or p_returned_model is null or p_returned_model !~ '^[!-~]{1,200}$'))
     or (p_outcome = 'noncharge' and (p_request_id is null or p_input_tokens is not null or p_output_tokens is not null or p_returned_model is not null)) then
    raise exception 'invalid argument' using errcode = '22023';
  end if;

  -- 2. The operation, and its Job's lock (the order of every command: the Job, then the operation row, then the Usage locks).
  select a.job_id into v_job_id
    from jobs.operations o
    join jobs.steps s on s.id = o.step_id
    join jobs.attempts a on a.id = s.attempt_id
   where o.id = p_operation_id;
  if not found then
    v_result.outcome := 'unavailable';
    return v_result;
  end if;
  perform pg_advisory_xact_lock(hashtextextended('nova3d:job:' || v_job_id::text, 0));
  select * into v_operation from jobs.operations o where o.id = p_operation_id for update;
  v_result.operation_id := v_operation.id;
  v_result.state := v_operation.state;

  -- The command ID of the settlement is derived from the operation and the evidence, so the same report again finds its receipt (`replayed`) and other evidence is another command.
  v_command := jobs.derived_id('reconcile', array[p_operation_id::text, p_outcome, p_input_tokens::text, p_output_tokens::text, p_returned_model]);

  -- 3. An ambiguous operation is reconciled by evidence (it settles at the evidence, the remainder released, and the operation is settled, which opens the gate) or by a proven noncharge
  -- (it moves to `noncharge`, which needs the provider's request ID, and settles 0).
  if v_operation.state = 'ambiguous' then
    begin
      if p_outcome = 'evidence' then
        v_settle := api.settle_cost(v_operation.account_id, v_command, p_operation_id, 'evidence', p_input_tokens, p_output_tokens, p_returned_model);
        if v_settle.outcome not in ('settled', 'replayed', 'corrected') then
          raise exception using errcode = 'N3050', message = 'refused', detail = v_settle.outcome, hint = coalesce(v_settle.reason, '');
        end if;
        update jobs.operations o set state = 'settled', request_id = coalesce(o.request_id, p_request_id) where o.id = p_operation_id returning * into v_operation;
      else
        update jobs.operations o set state = 'noncharge', request_id = coalesce(o.request_id, p_request_id) where o.id = p_operation_id returning * into v_operation;
        v_settle := api.settle_cost(v_operation.account_id, v_command, p_operation_id, 'noncharge');
        if v_settle.outcome not in ('settled', 'replayed') then
          raise exception using errcode = 'N3050', message = 'refused', detail = v_settle.outcome, hint = coalesce(v_settle.reason, '');
        end if;
      end if;
    exception when sqlstate 'N3050' then
      -- Nothing was written: the settlement refused, and the move (if it was made) is undone with this sub-block.
      get stacked diagnostics v_word = pg_exception_detail, v_reason = pg_exception_hint;
      select * into v_operation from jobs.operations o where o.id = p_operation_id;
      v_result.outcome := v_word;
      v_result.reason := nullif(v_reason, '');
      v_result.state := v_operation.state;
      return v_result;
    end;
    v_result.outcome := case v_settle.outcome when 'corrected' then 'corrected' else 'reconciled' end;
  elsif (p_outcome = 'evidence' and v_operation.state in ('settled', 'completed')) or (p_outcome = 'noncharge' and v_operation.state = 'noncharge') then
    -- 4. Already past the ambiguity: the same report again is a replay; late evidence after a deadline booking appends ONE correction; another is refused by the settlement.
    v_settle := api.settle_cost(
      v_operation.account_id, v_command, p_operation_id, p_outcome,
      case when p_outcome = 'evidence' then p_input_tokens end, case when p_outcome = 'evidence' then p_output_tokens end, case when p_outcome = 'evidence' then p_returned_model end);
    v_result.outcome := case v_settle.outcome when 'settled' then 'reconciled' else v_settle.outcome end;
  else
    -- planned, dispatched and abandoned operations have no ambiguity to reconcile; a noncharge proven after a deadline booking (or evidence for a noncharge) is not reconciled here.
    v_result.outcome := 'not_reconcilable';
    return v_result;
  end if;

  v_result.reason := v_settle.reason;
  v_result.settlement_id := v_settle.settlement_id;
  v_result.correction_id := v_settle.correction_id;
  v_result.incident_id := v_settle.incident_id;
  v_result.classification := v_settle.classification;
  v_result.settled_microdollars := v_settle.settled_microdollars;
  v_result.released_microdollars := v_settle.released_microdollars;
  v_result.over_microdollars := v_settle.over_microdollars;
  v_result.delta_microdollars := v_settle.delta_microdollars;
  select * into v_operation from jobs.operations o where o.id = p_operation_id;
  v_result.state := v_operation.state;
  return v_result;
end;
$$;

comment on function api.reconcile_operation(uuid, text, bigint, bigint, text, text) is
  'Reconciles an operation that went out with an unknown outcome, with no Account authority (it records what already happened): an ambiguous operation with usage evidence settles at the evidence (the remainder released) and becomes settled; with a proven noncharge (a request ID is required) it becomes noncharge and settles 0; an operation settled by the deadline that gets evidence appends ONE correction (evidence above the reservation also opens an incident); the same report again is replayed. Under the Job lock and the operation row. reconciled | corrected | replayed | not_reconcilable (planned, dispatched, abandoned, or a noncharge proven after a deadline booking) | unavailable | the settlement''s refusal word (already_settled, invalid_evidence, overflow, not_reserved, ...).';

-- The Administrator's list and clearing of overrun incidents ---------------------------------------------------------------------------------

-- outcome: listed | denied. incidents: an array of objects, at most p_limit, open first and then the newest, across all Accounts: incident_id, account_id, provider, operation_id, job_id,
-- reserved_microdollars, evidence_microdollars, over_microdollars, created_at, cleared_at, cleared_by (user:<Auth user ID>) and cleared_by_email (the verified address of the Account that cleared it).
create type api.incident_listing as (outcome text, incidents jsonb);

create function api.list_overrun_incidents(p_account_id uuid, p_epoch bigint, p_limit integer default 50)
returns api.incident_listing
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_result api.incident_listing;
  v_role text;
begin
  if p_account_id is null or p_epoch is null or p_epoch < 1 or p_limit is null or p_limit < 1 or p_limit > 200 then
    raise exception 'invalid argument' using errcode = '22023';
  end if;
  begin
    perform identity.assert_operation_authority(p_account_id, p_epoch);
  exception when sqlstate 'N3010' then
    v_result.outcome := 'denied';
    return v_result;
  end;
  select a.role into v_role from identity.accounts a where a.id = p_account_id;
  if v_role is distinct from 'administrator' then
    v_result.outcome := 'denied';
    return v_result;
  end if;

  select coalesce(jsonb_agg(
           jsonb_build_object(
             'incident_id', t.id, 'account_id', t.account_id, 'provider', t.provider, 'operation_id', t.operation_id, 'job_id', t.job_id,
             'reserved_microdollars', t.reserved_microdollars, 'evidence_microdollars', t.evidence_microdollars,
             'over_microdollars', t.evidence_microdollars - t.reserved_microdollars,
             'created_at', t.created_at, 'cleared_at', t.cleared_at, 'cleared_by', t.cleared_by,
             'cleared_by_email', (select g.verified_email
                                    from identity.accounts c
                                    left join lateral identity.verified_google(c.user_id) g on true
                                   where t.cleared_by = 'user:' || c.user_id::text
                                   limit 1)
           ) order by (t.cleared_at is not null), t.created_at desc, t.id),
         '[]'::jsonb)
    into v_result.incidents
    from (
      select i.id, i.account_id, i.provider, r.operation_id, r.job_id, i.reserved_microdollars, i.evidence_microdollars, i.created_at, i.cleared_at, i.cleared_by
        from usage.overrun_incidents i
        join usage.reservations r on r.id = i.reservation_id and r.account_id = i.account_id
       order by (i.cleared_at is not null), i.created_at desc, i.id
       limit p_limit
    ) t;
  v_result.outcome := 'listed';
  return v_result;
end;
$$;

comment on function api.list_overrun_incidents(uuid, bigint, integer) is
  'The overrun incidents of every Account, for the Administrator: open first, then the newest, at most the limit (1 to 200, default 50), each with provider, operation, Job, reserved, evidence, over, when, and when and by whom it was cleared. listed | denied (unless an active Administrator under the epoch).';

-- outcome: cleared | already_cleared | unavailable | denied.
create type api.incident_clearing as (outcome text, incident_id uuid, cleared_at timestamptz, cleared_by text);

create function api.clear_overrun_incident(p_account_id uuid, p_epoch bigint, p_command_id uuid, p_incident_id uuid)
returns api.incident_clearing
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_result api.incident_clearing;
  v_role text;
  v_user uuid;
  v_incident usage.overrun_incidents;
  v_actor text;
begin
  if p_account_id is null or p_epoch is null or p_epoch < 1 or p_command_id is null or p_incident_id is null then
    raise exception 'invalid argument' using errcode = '22023';
  end if;
  -- The Administrator's authority (this takes the Administrator's Account row FOR SHARE until the end of the transaction), and the role. The fresh administration marker is
  -- checked by the application, exactly as for a change of limit.
  begin
    perform identity.assert_operation_authority(p_account_id, p_epoch);
  exception when sqlstate 'N3010' then
    v_result.outcome := 'denied';
    return v_result;
  end;
  select a.role, a.user_id into v_role, v_user from identity.accounts a where a.id = p_account_id;
  if v_role is distinct from 'administrator' then
    v_result.outcome := 'denied';
    return v_result;
  end if;

  -- The incident's row is locked: two clearings are serial, and the second finds it cleared.
  select * into v_incident from usage.overrun_incidents i where i.id = p_incident_id for update;
  if not found then
    v_result.outcome := 'unavailable';
    return v_result;
  end if;
  v_result.incident_id := v_incident.id;
  if v_incident.cleared_at is not null then
    v_result.outcome := 'already_cleared';
    v_result.cleared_at := v_incident.cleared_at;
    v_result.cleared_by := v_incident.cleared_by;
    return v_result;
  end if;

  v_actor := 'user:' || v_user::text;
  update usage.overrun_incidents i set cleared_at = clock_timestamp(), cleared_by = v_actor where i.id = p_incident_id returning * into v_incident;
  perform identity.record_audit(v_actor, 'usage.incident_cleared', 'incident:' || p_incident_id::text);
  v_result.outcome := 'cleared';
  v_result.cleared_at := v_incident.cleared_at;
  v_result.cleared_by := v_incident.cleared_by;
  return v_result;
end;
$$;

comment on function api.clear_overrun_incident(uuid, bigint, uuid, uuid) is
  'Clears an overrun incident, once: the Administrator''s authority and role under the epoch, the incident''s row locked, cleared_at and cleared_by (user:<Auth user ID>) set, and the audit event usage.incident_cleared (target incident:<id>) written in the same transaction. The provider''s admissions resume when its last incident is cleared. The fresh administration marker is checked by the application. cleared | already_cleared | unavailable | denied.';

-- Refused clearings --------------------------------------------------------------------------------------------------------------------------

-- As Story 2.4 left it, with one more action: `usage.incident_refused`, an Administrator whose fresh marker was missing or expired when they tried to clear an incident.
create or replace function api.record_usage_refusal(p_user_id uuid, p_action text, p_target_account_id uuid default null)
returns api.usage_refusal
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_result api.usage_refusal;
  v_role text;
  v_actor text;
  v_target text;
  v_seen boolean;
begin
  if p_user_id is null or p_action is null or p_action not in ('usage.limit_refused', 'usage.denied', 'usage.incident_refused') then
    raise exception 'invalid argument' using errcode = '22023';
  end if;

  select a.role into v_role from identity.accounts a where a.user_id = p_user_id;
  if not found or (p_action = 'usage.denied') = (v_role = 'administrator') then
    raise exception 'invalid argument' using errcode = '22023';
  end if;

  v_actor := 'user:' || p_user_id::text;
  if p_target_account_id is not null and exists (select 1 from identity.accounts a where a.id = p_target_account_id) then
    v_target := 'account:' || p_target_account_id::text;
  end if;

  perform pg_advisory_xact_lock(hashtextextended('usage_refusal:' || v_actor || ':' || p_action || ':' || coalesce(v_target, ''), 0));
  v_seen := exists (
    select 1 from identity.audit_events e
     where e.actor = v_actor and e.action = p_action and e.target is not distinct from v_target
       and e.occurred_at > clock_timestamp() - interval '1 hour'
  );
  perform identity.record_audit_once(v_actor, p_action, v_target);
  v_result.outcome := case when v_seen then 'repeated' else 'recorded' end;
  return v_result;
end;
$$;

comment on function api.record_usage_refusal(uuid, text, uuid) is
  'Records a refused usage-limit change (usage.limit_refused or usage.denied) or a refused clearing of an overrun incident (usage.incident_refused, an Administrator without a valid marker) for an Account: the actor and the Account as target when it exists. At most once an hour per actor, action and target. Never content. recorded | repeated.';

-- The sweep: mark, settle at the deadline, isolate -----------------------------------------------------------------------------------------

-- The sweep's counts. `expired`, `cancelled` and `settled` are as Story 2.7 left them; `marked` is the dispatched operations of ended attempts that became ambiguous, `reconciled` the
-- ambiguous operations settled at their deadline, and `failed` the operations (of any stage) that could not be moved or settled and were skipped.
alter type api.dispatch_sweep add attribute marked integer;
alter type api.dispatch_sweep add attribute reconciled integer;
alter type api.dispatch_sweep add attribute failed integer;

create or replace function api.sweep_attempts()
returns api.dispatch_sweep
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_result api.dispatch_sweep;
  r record;
  v_locked uuid[] := '{}';
  v_operation uuid;
  v_settle api.cost_settlement;
  v_abandoned record;
begin
  -- Two sweeps never run together: the second waits and finds nothing left to do.
  perform pg_advisory_xact_lock(hashtextextended('nova3d:jobs-sweep', 0));
  v_result.expired := 0;
  v_result.marked := 0;
  v_result.reconciled := 0;
  v_result.failed := 0;

  -- 1. An Account that is disabled, or whose epoch is not the one an attempt is bound to, loses its open attempts first (authority before expiry).
  v_result.cancelled := jobs.cancel_attempts(null, 100);

  -- 2. Every live lease past its expiry ends, whatever became of its attempt. A running attempt fails as an interrupted one (lease_lost); nothing retries by itself. An attempt that is
  -- no longer running (api.move_attempt moved it by hand, which does not end its lease) keeps its state: only its lease ends, so the expired-lease alarm clears.
  for r in
    select l.attempt_id, a.job_id
      from jobs.leases l join jobs.attempts a on a.id = l.attempt_id
     where l.ended_at is null and l.expires_at <= clock_timestamp()
     order by l.expires_at, l.id
     limit 100
  loop
    perform pg_advisory_xact_lock(hashtextextended('nova3d:job:' || r.job_id::text, 0));
    if exists (select 1 from jobs.leases l where l.attempt_id = r.attempt_id and l.ended_at is null and l.expires_at <= clock_timestamp()) then
      if exists (select 1 from jobs.attempts a where a.id = r.attempt_id and a.state = 'running') then
        perform jobs.end_attempt(r.attempt_id, 'failed', 'lease_lost', 'expired', 'lease_expired');
      else
        update jobs.leases l set ended_at = clock_timestamp(), end_reason = 'expired', detail = 'lease_expired' where l.attempt_id = r.attempt_id and l.ended_at is null;
      end if;
      v_result.expired := v_result.expired + 1;
    end if;
  end loop;

  -- 3. A `dispatched` operation whose attempt is no longer running (failed, cancelled or completed: a lost lease is the case nobody reports) is ambiguous: the 24-hour clock starts here.
  -- Each in its own sub-block; the reservation stays held.
  for r in
    select o.id as operation_id
      from jobs.operations o
      join jobs.steps s on s.id = o.step_id
      join jobs.attempts a on a.id = s.attempt_id
     where o.state = 'dispatched' and a.state in ('failed', 'cancelled', 'completed')
     order by o.dispatched_at, o.id
     limit 100
  loop
    begin
      if jobs.mark_ambiguous(r.operation_id) then
        v_result.marked := v_result.marked + 1;
      end if;
    exception when others then
      v_result.failed := v_result.failed + 1;
    end;
  end loop;

  -- 4. Every ambiguous operation with a reservation and no settlement whose 24 hours are up settles ONCE at its reservation (class `deadline`), oldest first, and then becomes `settled`,
  -- which opens the gate for a waiting retry. In two passes, so the sweep takes every Job lock it needs BEFORE it takes the first Usage lock (a command that holds one Job lock and waits
  -- for the Usage lock of the Account then never waits for a lock the sweep is waiting for): first the Job locks and the operation rows, then the settlements, each in its own sub-block.
  for r in
    select o.id as operation_id, a.job_id
      from jobs.operations o
      join jobs.steps s on s.id = o.step_id
      join jobs.attempts a on a.id = s.attempt_id
      join usage.reservations rv on rv.operation_id = o.id
     where o.state = 'ambiguous'
       and o.outcome_at + usage.ambiguity_deadline() <= clock_timestamp()
       and not exists (select 1 from usage.settlements st where st.reservation_id = rv.id)
     order by o.outcome_at, o.id
     limit 100
  loop
    begin
      perform pg_advisory_xact_lock(hashtextextended('nova3d:job:' || r.job_id::text, 0));
      -- Under the lock the operation may have been reconciled meanwhile: it is judged again, and held FOR UPDATE.
      perform 1
        from jobs.operations o
       where o.id = r.operation_id and o.state = 'ambiguous' and o.outcome_at + usage.ambiguity_deadline() <= clock_timestamp()
         and not exists (select 1 from usage.reservations rv join usage.settlements st on st.reservation_id = rv.id where rv.operation_id = o.id)
         for update;
      if found then
        v_locked := v_locked || r.operation_id;
      end if;
    exception when others then
      v_result.failed := v_result.failed + 1;
    end;
  end loop;
  foreach v_operation in array v_locked loop
    begin
      v_settle := api.settle_cost(
        (select o.account_id from jobs.operations o where o.id = v_operation), jobs.derived_id('settle_deadline', array[v_operation::text]), v_operation, 'deadline');
      if v_settle.outcome in ('settled', 'replayed') then
        update jobs.operations o set state = 'settled' where o.id = v_operation and o.state = 'ambiguous';
        v_result.reconciled := v_result.reconciled + 1;
      else
        -- not_due, overflow, not_settleable ...: nothing was written, the operation stays ambiguous, and the alarm shows it.
        v_result.failed := v_result.failed + 1;
      end if;
    exception when others then
      v_result.failed := v_result.failed + 1;
    end;
  end loop;

  -- 5. What never went out is released, after every Job lock is taken. One that cannot settle is counted, never raised.
  select * into v_abandoned from jobs.settle_abandoned_counted(null, null, 100);
  v_result.settled := v_abandoned.settled;
  v_result.failed := v_result.failed + v_abandoned.failed;
  return v_result;
end;
$$;

comment on function api.sweep_attempts() is
  'The minute sweep''s database work: cancels the open attempts of a disabled Account or of an epoch that moved (account_disabled, lease revoked), ends every live lease past its expiry (expired) and fails its attempt as lease_lost (an attempt that is no longer running keeps its state, only its lease ends), marks the dispatched operations of ended attempts ambiguous (the 24-hour clock starts), settles each ambiguous operation whose 24 hours are up ONCE at its reservation (class deadline) and moves it to settled, and settles unused the abandoned operations that hold reservations. Each operation in its own sub-block: one that fails is counted and the others go on. Returns the counts (expired, cancelled, settled, marked, reconciled, failed). Safe to run twice or at once.';

-- The alarm --------------------------------------------------------------------------------------------------------------------------------

-- One more observation: how old, in seconds on the database clock, the oldest operation of UNKNOWN COST is: dispatched or ambiguous, with a reservation and no settlement, measured from the
-- time its outcome was recorded (or, for a dispatched one, from its dispatch). Null for none.
alter type api.alarm_observation add attribute unknown_cost_oldest bigint;

create or replace function api.alarm_observations()
returns api.alarm_observation
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_result api.alarm_observation;
  v_oldest timestamptz;
begin
  select lifecycle.age_seconds(min(r.started_at)), lifecycle.age_seconds(max(r.started_at))
    into v_result.first_receipt_age, v_result.latest_receipt_age
    from lifecycle.job_receipts r;

  select lifecycle.age_seconds(min(h.received_at)), lifecycle.age_seconds(max(h.received_at))
    into v_result.first_heartbeat_age, v_result.latest_heartbeat_age
    from lifecycle.heartbeats h;

  select count(*)::integer, min(o.created_at)
    into v_result.ledger_pending, v_oldest
    from lifecycle.ledger_outbox o
   where o.relayed_at is null;
  v_result.ledger_oldest := lifecycle.age_seconds(v_oldest);

  select count(*)::integer
    into v_result.unaccounted
    from auth.users u
   where not exists (select 1 from identity.accounts a where a.user_id = u.id);

  select coalesce(json_agg(
           json_build_object('task', t.task, 'outcome', t.outcome, 'at', lifecycle.iso_utc(t.finished_at), 'age', lifecycle.age_seconds(t.finished_at))
           order by t.task
         ), '[]'::json)
    into v_result.tasks
    from (
      select distinct on (r.task) r.task, r.outcome, r.finished_at
        from lifecycle.job_receipts r
       where r.finished_at is not null
       order by r.task, r.finished_at desc, r.id
    ) t;

  select lifecycle.age_seconds(min(o.created_at)) into v_result.outbox_oldest from jobs.outbox o where o.published_at is null;
  select lifecycle.age_seconds(min(l.expires_at)) into v_result.lease_expired_oldest
    from jobs.leases l where l.ended_at is null and l.expires_at <= clock_timestamp() - make_interval(secs => jobs.lease_alarm_seconds());

  select lifecycle.age_seconds(min(coalesce(o.outcome_at, o.dispatched_at))) into v_result.unknown_cost_oldest
    from jobs.operations o
    join usage.reservations rv on rv.operation_id = o.id
   where o.state in ('dispatched', 'ambiguous')
     and not exists (select 1 from usage.settlements st where st.reservation_id = rv.id);
  return v_result;
end;
$$;

comment on function api.alarm_observations() is
  'The ages in seconds, on the database clock, that the registry of alarm conditions needs: the first and latest receipt of any task, the first and latest heartbeat, the ledger backlog, the Auth identities with no Account, each task''s newest finished receipt, the oldest unpublished outbox row, the oldest live lease that expired more than 300 seconds ago and the oldest operation of unknown cost (dispatched or ambiguous, reserved and unsettled). Read-only.';

-- The preflight -----------------------------------------------------------------------------------------------------------------------------------

-- Everything api.preflight read when 20261031120000_durable_dispatch.sql re-created it, plus what Story 2.8 depends on: the corrections table (and the incident's new column), the
-- constant function and the three new `api` functions (seventy-two in all, each executable by the service role) with the internal ones behind them. It checks the catalog and executes
-- none of them, reads at most one row of each table and writes nothing. The bucket check stays last.
create or replace function api.preflight()
returns api.preflight_result
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_result api.preflight_result;
  v_missing text;
begin
  perform g.session_id, g.csrf_hash, g.csrf_issued_at from identity.session_grants g limit 1;
  perform a.id, a.status, a.authorization_epoch, a.status_handle from identity.accounts a limit 1;
  perform p.account_id, p.locale, p.theme, p.detail, p.guidance, p.created_at, p.updated_at from identity.account_preferences p limit 1;
  perform 1 from identity.step_up_nonces limit 1;
  perform m.session_id, m.nonce_id, m.source from identity.fresh_authentications m limit 1;
  perform t.id, t.account_id, t.token_hash, t.issued_at, t.expires_at, t.used_at, t.voided_at from identity.recovery_tokens t limit 1;
  perform j.id, j.workspace_id, j.account_id, j.title, j.stage, j.current_version, j.revision, j.status_handle, j.created_at, j.updated_at, j.deleted_at from projects.projects j limit 1;
  perform c.account_id, c.command_id, c.project_id, c.command, c.payload_hash, c.expected_revision, c.title, c.revision, c.created_at from projects.project_commands c limit 1;
  perform q.id, q.project_id, q.account_id, q.seq, q.command_id, q.mode, q.subject_id, q.scope, q.outcome, q.description, q.personalization_wording, q.personalization_text, q.personalization_style, q.personalization_applied, q.personalization_reason, q.digest, q.confirmed_at, q.created_at, q.obstruction_confirmed_at, q.incomplete_acknowledged_at, q.incomplete_acknowledged_digest from projects.request_revisions q limit 1;
  perform y.revision_id, y.project_id, y.account_id, y.position, y.upload_id, y.sha256, y.length, y.content_type, y.view_label, y.short_edge_px, y.blur_variance, y.clipped_fraction, y.retained_root, y.retained_sha256, y.retained_length from projects.request_images y limit 1;
  perform s.kind, s.target_id, s.status_handle, s.revision, s.recorded_at from lifecycle.tombstones s limit 1;
  perform o.seq, o.id, o.event, o.created_at, o.relayed_at from lifecycle.ledger_outbox o limit 1;
  perform r.id, r.holder, r.lease_expires_at from lifecycle.ledger_relay r limit 1;
  perform q.scope, q.key_hash, q.window_id, q.requests, q.expires_at from lifecycle.status_requests q limit 1;
  perform b.id, b.task, b.schedule_id, b.message_id, b.attempt, b.started_at, b.finished_at, b.outcome, b.result from lifecycle.job_receipts b limit 1;
  perform l.id, l.account_id, l.kid, l.kind, l.length, l.sha256, l.content_type, l.received_length, l.state, l.created_at, l.expires_at from artifacts.staging_leases l limit 1;
  perform d.jti, d.typ, d.issuer, d.kid, d.account_id, d.session_id, d.direction, d.target_kind, d.target_id, d.expires_at, d.redeemed_at from artifacts.ticket_redemptions d limit 1;
  perform h.hash, h.jti, h.session_id, h.account_id, h.epoch, h.direction, h.target_kind, h.target_id, h.kid, h.created_at, h.expires_at, h.ended_at from artifacts.transfer_handles h limit 1;
  perform f.root, f.id, f.account_id, f.upload_id, f.kind, f.digest, f.length, f.serialization, f.activity, f.body, f.created_at from artifacts.manifests f limit 1;
  perform x.name, x.registered_at from artifacts.attachment_transforms x limit 1;
  perform v.issuer, v.kid, v.reason, v.revoked_at from artifacts.service_key_revocations v limit 1;
  perform w.session_id, w.account_id, w.epoch, w.state from artifacts.session_authority w limit 1;
  perform n.environment, n.instance_id from artifacts.instance n limit 1;
  perform e2.account_id, e2.upload_id, e2.root, e2.digest, e2.length, e2.content_type from artifacts.retained_pictures e2 limit 1;
  perform k.id, k.condition, k.subject, k.first_at, k.latest_at, k.resolved_at, k.detail from lifecycle.alarms k limit 1;
  perform e.id, e.alarm_id, e.at, e.outcome from lifecycle.alarm_notices e limit 1;
  perform z.id, z.jti, z.kid, z.received_at from lifecycle.heartbeats z limit 1;
  perform u.id, u.account_id, u.seq, u.month_start, u.limit_microdollars, u.carried_settled_microdollars, u.carried_reserved_microdollars, u.cause, u.previous_limit_microdollars, u.actor, u.command_id, u.digest, u.created_at from usage.periods u limit 1;
  perform jb.id, jb.account_id, jb.project_id, jb.kind, jb.created_at from jobs.jobs jb limit 1;
  perform at.id, at.account_id, at.job_id, at.number, at.previous_attempt_id, at.input_digest, at.state, at.stage, at.reason, at.created_at, at.started_at, at.ended_at from jobs.attempts at limit 1;
  perform sp.id, sp.account_id, sp.attempt_id, sp.step_key, sp.created_at from jobs.steps sp limit 1;
  perform op.id, op.account_id, op.step_id, op.ordinal, op.state, op.request_id, op.created_at, op.dispatched_at, op.outcome_at from jobs.operations op limit 1;
  perform cm.account_id, cm.command_id, cm.kind, cm.digest, cm.subject_id, cm.created_at from jobs.commands cm limit 1;
  perform rs.id, rs.provider, rs.model, rs.version, rs.api_version, rs.currency, rs.input_rate_num, rs.input_rate_den, rs.output_rate_num, rs.output_rate_den, rs.request_rate_num, rs.request_rate_den, rs.input_increment, rs.output_increment, rs.multiplier_num, rs.multiplier_den, rs.created_at from usage.rate_schedules rs limit 1;
  perform rv.id, rv.account_id, rv.period_id, rv.job_id, rv.operation_id, rv.rate_schedule_id, rv.provider, rv.requested_model, rv.api_version, rv.request_bytes, rv.image_count, rv.output_limit, rv.input_bound, rv.reserved_microdollars, rv.digest, rv.created_at from usage.reservations rv limit 1;
  perform st.id, st.account_id, st.reservation_id, st.period_id, st.classification, st.settled_microdollars, st.released_microdollars, st.input_tokens, st.output_tokens, st.returned_model, st.digest, st.created_at from usage.settlements st limit 1;
  perform oi.id, oi.account_id, oi.reservation_id, oi.settlement_id, oi.correction_id, oi.provider, oi.reserved_microdollars, oi.evidence_microdollars, oi.created_at, oi.cleared_at, oi.cleared_by from usage.overrun_incidents oi limit 1;
  perform co.id, co.account_id, co.reservation_id, co.settlement_id, co.period_id, co.settled_delta_microdollars, co.input_tokens, co.output_tokens, co.returned_model, co.digest, co.created_at from usage.corrections co limit 1;
  perform uc.account_id, uc.command_id, uc.kind, uc.digest, uc.subject_id, uc.created_at from usage.commands uc limit 1;
  perform pp.id, pp.account_id, pp.project_id, pp.job_id, pp.attempt_id, pp.category, pp.provider, pp.purpose, pp.outbound_data, pp.disclosed_maximum_microdollars, pp.granted_at, pp.expires_at, pp.revoked_at from provider_private.permissions pp limit 1;
  perform ob.id, ob.account_id, ob.job_id, ob.attempt_id, ob.kind, ob.plan, ob.account_epoch, ob.project_revision, ob.worker_version, ob.created_at, ob.publish_until, ob.published_at, ob.message_id from jobs.outbox ob limit 1;
  perform wk.id, wk.issuer, wk.worker_kind, wk.version, wk.image_digest, wk.kinds, wk.registered_at, wk.retired_at from jobs.workers wk limit 1;
  perform ls.id, ls.account_id, ls.attempt_id, ls.worker_id, ls.fence, ls.claimed_at, ls.renewed_at, ls.expires_at, ls.ended_at, ls.end_reason, ls.detail, ls.result_digest from jobs.leases ls limit 1;
  perform cb.jti, cb.issuer, cb.kid, cb.typ, cb.command, cb.attempt_id, cb.digest, cb.created_at from jobs.callbacks cb limit 1;
  perform 1 from auth.sessions limit 1;
  perform 1 from auth.identities limit 1;
  perform 1 from auth.mfa_amr_claims limit 1;

  select string_agg(f.signature, ', ') into v_missing
    from unnest(array[
      'api.list_accounts()',
      'api.disable_account(text,uuid)',
      'api.enable_account(text,uuid)',
      'api.guard_operation(uuid,bigint)',
      'api.record_account_refusal(uuid,text,uuid)',
      'identity.assert_operation_authority(uuid,bigint)'
    ]) as f(signature)
   where to_regprocedure(f.signature) is null;
  if v_missing is not null then
    raise exception 'api.preflight: the Story 1.5 migration is not applied (missing %)', v_missing using errcode = 'N3020';
  end if;

  select string_agg(f.signature, ', ') into v_missing
    from unnest(array[
      'api.issue_recovery(text,text)',
      'api.void_recovery(text,boolean)',
      'api.check_recovery(text,text)',
      'api.redeem_recovery(text,text,uuid,uuid)',
      'identity.recovery_administrator(text)',
      'identity.record_recovery_refusal(text,text,text)'
    ]) as f(signature)
   where to_regprocedure(f.signature) is null;
  if v_missing is not null then
    raise exception 'api.preflight: the Story 1.6 migration is not applied (missing %)', v_missing using errcode = 'N3020';
  end if;

  select string_agg(f.signature, ', ') into v_missing
    from unnest(array[
      'api.list_projects(uuid,bigint,integer)',
      'api.get_project(uuid,bigint,uuid)',
      'api.rename_project(uuid,bigint,uuid,uuid,bigint,text)'
    ]) as f(signature)
   where to_regprocedure(f.signature) is null;
  if v_missing is not null then
    raise exception 'api.preflight: the Story 1.7 migration is not applied (missing %)', v_missing using errcode = 'N3020';
  end if;

  select string_agg(f.signature, ', ') into v_missing
    from unnest(array[
      'api.record_tombstone(text,uuid)',
      'api.guard_target(uuid,bigint,text,uuid)',
      'api.claim_ledger_events(uuid,integer,integer)',
      'api.finish_ledger_events(uuid,uuid[],boolean)',
      'api.ledger_pending()',
      'api.lookup_status(text,text)',
      'lifecycle.assert_not_tombstoned(text,uuid)'
    ]) as f(signature)
   where to_regprocedure(f.signature) is null;
  if v_missing is not null then
    raise exception 'api.preflight: the Story 1.8 migration is not applied (missing %)', v_missing using errcode = 'N3020';
  end if;

  select string_agg(f.signature, ', ') into v_missing
    from unnest(array[
      'api.claim_job_run(text,text,text,integer)',
      'api.finish_job_run(uuid,text,json)',
      'api.last_job_run(text)',
      'api.purge_dormant_identities(integer)',
      'lifecycle.job_result_ok(json)'
    ]) as f(signature)
   where to_regprocedure(f.signature) is null;
  if v_missing is not null then
    raise exception 'api.preflight: the Story 1.9 migration is not applied (missing %)', v_missing using errcode = 'N3020';
  end if;

  select string_agg(f.signature, ', ') into v_missing
    from unnest(array[
      'api.revoke_service_key(text,text,text)',
      'api.list_expired_staging(integer)',
      'artifacts.publish_attachment(uuid,bigint,uuid,text,text,text)'
    ]) as f(signature)
   where to_regprocedure(f.signature) is null;
  if v_missing is not null then
    raise exception 'api.preflight: the Story 1.12 migration is not applied (missing %)', v_missing using errcode = 'N3020';
  end if;

  select string_agg(f.signature, ', ') into v_missing
    from unnest(array[
      'api.raise_alarm(text,text,json)',
      'api.resolve_alarm(text,text)',
      'api.list_alarms(boolean,integer)',
      'api.alarms_due_mail(integer)',
      'api.record_alarm_notice(uuid,text)',
      'api.alarm_observations()',
      'api.record_heartbeat(text,text)',
      'lifecycle.alarm_detail_ok(json)'
    ]) as f(signature)
   where to_regprocedure(f.signature) is null;
  if v_missing is not null then
    raise exception 'api.preflight: the Story 1.13 migration is not applied (missing %)', v_missing using errcode = 'N3020';
  end if;

  select string_agg(f.signature, ', ') into v_missing
    from unnest(array[
      'api.create_project_request(uuid,bigint,uuid,text,text,text,text,text,text,text,text,text,boolean,text)',
      'api.read_project_request(uuid,bigint,uuid)'
    ]) as f(signature)
   where to_regprocedure(f.signature) is null;
  if v_missing is not null then
    raise exception 'api.preflight: the Story 2.1 migration is not applied (missing %)', v_missing using errcode = 'N3020';
  end if;

  select string_agg(f.signature, ', ') into v_missing
    from unnest(array[
      'api.record_picture_set(uuid,bigint,uuid,uuid,text,uuid[])',
      'api.release_staged_pictures(uuid,bigint,uuid[])',
      'projects.picture_set_digest(uuid,uuid,uuid[])'
    ]) as f(signature)
   where to_regprocedure(f.signature) is null;
  if v_missing is not null then
    raise exception 'api.preflight: the Story 2.2 migration is not applied (missing %)', v_missing using errcode = 'N3020';
  end if;

  select string_agg(f.signature, ', ') into v_missing
    from unnest(array[
      'api.record_picture_review(uuid,bigint,uuid,uuid,integer,text,text,text,jsonb,boolean,boolean)',
      'projects.picture_review_images_valid(jsonb)',
      'projects.picture_review_incomplete(jsonb)',
      'projects.picture_review_digest(uuid,text,text,uuid[],text[])',
      'projects.picture_review_command_digest(uuid,uuid,integer,text,text,text,jsonb,boolean,boolean)'
    ]) as f(signature)
   where to_regprocedure(f.signature) is null;
  if v_missing is not null then
    raise exception 'api.preflight: the Story 2.3 migration is not applied (missing %)', v_missing using errcode = 'N3020';
  end if;

  select string_agg(f.signature, ', ') into v_missing
    from unnest(array[
      'api.check_picture_retention(uuid,bigint,uuid,integer,uuid[])',
      'api.read_retained_pictures(uuid,bigint,uuid)'
    ]) as f(signature)
   where to_regprocedure(f.signature) is null;
  if v_missing is not null then
    raise exception 'api.preflight: the Story 2.12 migration is not applied (missing %)', v_missing using errcode = 'N3020';
  end if;

  select string_agg(f.signature, ', ') into v_missing
    from unnest(array[
      'api.set_usage_limit(text,uuid,bigint,uuid,uuid,text,bigint,integer)',
      'api.list_usage(uuid,bigint)',
      'api.record_usage_refusal(uuid,text,uuid)',
      'usage.ensure_period(uuid)',
      'usage.period_figures(uuid)',
      'usage.available_microdollars(uuid)',
      'usage.default_limit(text)'
    ]) as f(signature)
   where to_regprocedure(f.signature) is null;
  if v_missing is not null then
    raise exception 'api.preflight: the Story 2.4 migration is not applied (missing %)', v_missing using errcode = 'N3020';
  end if;

  select string_agg(f.signature, ', ') into v_missing
    from unnest(array[
      'api.accept_job(uuid,bigint,uuid,uuid,text,text)',
      'api.begin_step(uuid,bigint,uuid,uuid,text,integer)',
      'api.advance_operation(uuid,bigint,uuid,uuid,text,text)',
      'api.move_attempt(uuid,bigint,uuid,uuid,text,text)',
      'api.request_retry(uuid,bigint,uuid,uuid,integer,text)',
      'api.read_job(uuid,bigint,uuid)'
    ]) as f(signature)
   where to_regprocedure(f.signature) is null;
  if v_missing is not null then
    raise exception 'api.preflight: the Story 2.11 migration is not applied (missing %)', v_missing using errcode = 'N3020';
  end if;

  select string_agg(f.signature, ', ') into v_missing
    from unnest(array[
      'api.quote_cost(uuid,bigint,uuid,text,text,text,bigint,integer,integer,integer,jsonb)',
      'api.reserve_cost(uuid,bigint,uuid,uuid,uuid,text,text,text,bigint,integer,integer,jsonb)',
      'api.settle_cost(uuid,uuid,uuid,text,bigint,bigint,text)',
      'usage.input_bound(bigint,integer)',
      'usage.price(uuid,numeric,numeric,integer)',
      'usage.job_exposure(uuid)',
      'usage.overhead_tokens()',
      'usage.image_tokens()',
      'usage.margin_percent()',
      'usage.input_ceiling()',
      'usage.output_ceiling()',
      'usage.request_ceiling()',
      'usage.operation_cap()',
      'usage.job_cap()',
      'usage.ambiguity_deadline()'
    ]) as f(signature)
   where to_regprocedure(f.signature) is null;
  if v_missing is not null then
    raise exception 'api.preflight: the Story 2.6 migration is not applied (missing %)', v_missing using errcode = 'N3020';
  end if;

  select string_agg(f.signature, ', ') into v_missing
    from unnest(array[
      'api.grant_provider_permission(uuid,uuid,uuid,text,text,text,text[],bigint)',
      'api.get_provider_permission(uuid,uuid,uuid,text,text)',
      'api.revoke_provider_permission(uuid,uuid,uuid,uuid)',
      'api.reserve_cost(uuid,bigint,uuid,uuid,uuid,text,text,text,bigint,integer,integer,jsonb,uuid,uuid,uuid,text,text,text[])',
      'provider_private.reserve_cost_unchecked(uuid,bigint,uuid,uuid,uuid,text,text,text,bigint,integer,integer,jsonb)',
      'provider_private.revoke_permission(uuid,uuid,uuid,uuid)',
      'provider_private.valid_outbound(text[])',
      'provider_private.refusal(text)',
      'provider_private.is_permissioned_provider(text)',
      'provider_private.stamp_permission()',
      'provider_private.supersede_permission()',
      'provider_private.guard_permission_change()'
    ]) as f(signature)
   where to_regprocedure(f.signature) is null;
  if v_missing is not null then
    raise exception 'api.preflight: the Story 2.5 migration is not applied (missing %)', v_missing using errcode = 'N3020';
  end if;

  select string_agg(f.signature, ', ') into v_missing
    from unnest(array[
      'api.submit_job(uuid,bigint,uuid,uuid,text,text,jsonb,integer)',
      'api.cancel_job(uuid,bigint,uuid,uuid)',
      'api.list_jobs(uuid,bigint,integer)',
      'api.read_job_detail(uuid,bigint,uuid)',
      'api.register_worker(text,text,integer,text,text[])',
      'api.claim_attempt(uuid,uuid,text)',
      'api.renew_lease(uuid,uuid)',
      'api.run_step(uuid,uuid,text,integer)',
      'api.finish_operation(uuid,uuid,uuid,text,bigint,bigint,text,text)',
      'api.finish_attempt(uuid,uuid,text,text,bigint)',
      'api.record_callback(text,text,text,text,text,uuid,text)',
      'api.claim_outbox(integer,uuid)',
      'api.mark_published(uuid,text)',
      'api.sweep_attempts()',
      'api.cancel_account_jobs(uuid)',
      'jobs.lease_seconds()',
      'jobs.renewal_seconds()',
      'jobs.publish_grace_seconds()',
      'jobs.publish_lease_seconds()',
      'jobs.open_job_limit()',
      'jobs.outbox_alarm_seconds()',
      'jobs.lease_alarm_seconds()',
      'jobs.builtin_version()',
      'jobs.builtin_kind()',
      'jobs.reserve_planned(uuid,bigint,uuid,uuid,jsonb)',
      'jobs.create_outbox()',
      'jobs.executable(uuid)',
      'jobs.shown_reason(uuid,uuid,integer,text,text)'
    ]) as f(signature)
   where to_regprocedure(f.signature) is null;
  if v_missing is not null then
    raise exception 'api.preflight: the Story 2.7 migration is not applied (missing %)', v_missing using errcode = 'N3020';
  end if;

  select string_agg(f.signature, ', ') into v_missing
    from unnest(array[
      'api.reconcile_operation(uuid,text,bigint,bigint,text,text)',
      'api.list_overrun_incidents(uuid,bigint,integer)',
      'api.clear_overrun_incident(uuid,bigint,uuid,uuid)',
      'api.settle_cost(uuid,uuid,uuid,text,bigint,bigint,text)',
      'api.finish_operation(uuid,uuid,uuid,text,bigint,bigint,text,text)',
      'api.sweep_attempts()',
      'api.record_usage_refusal(uuid,text,uuid)',
      'api.alarm_observations()',
      'usage.unknown_cost_alarm_seconds()',
      'usage.check_correction()',
      'usage.period_figures(uuid)',
      'usage.job_exposure(uuid)',
      'jobs.mark_ambiguous(uuid)',
      'jobs.settle_abandoned(uuid,uuid,integer)',
      'jobs.settle_abandoned_counted(uuid,uuid,integer)'
    ]) as f(signature)
   where to_regprocedure(f.signature) is null;
  if v_missing is not null then
    raise exception 'api.preflight: the Story 2.8 migration is not applied (missing %)', v_missing using errcode = 'N3020';
  end if;

  select string_agg(f.signature, ', ') into v_missing
    from unnest(array[
      'api.list_accounts()',
      'api.disable_account(text,uuid)',
      'api.enable_account(text,uuid)',
      'api.guard_operation(uuid,bigint)',
      'api.record_account_refusal(uuid,text,uuid)',
      'api.issue_recovery(text,text)',
      'api.void_recovery(text,boolean)',
      'api.check_recovery(text,text)',
      'api.redeem_recovery(text,text,uuid,uuid)',
      'api.list_projects(uuid,bigint,integer)',
      'api.get_project(uuid,bigint,uuid)',
      'api.rename_project(uuid,bigint,uuid,uuid,bigint,text)',
      'api.record_tombstone(text,uuid)',
      'api.guard_target(uuid,bigint,text,uuid)',
      'api.claim_ledger_events(uuid,integer,integer)',
      'api.finish_ledger_events(uuid,uuid[],boolean)',
      'api.ledger_pending()',
      'api.lookup_status(text,text)',
      'api.claim_job_run(text,text,text,integer)',
      'api.finish_job_run(uuid,text,json)',
      'api.last_job_run(text)',
      'api.purge_dormant_identities(integer)',
      'api.revoke_service_key(text,text,text)',
      'api.list_expired_staging(integer)',
      'api.raise_alarm(text,text,json)',
      'api.resolve_alarm(text,text)',
      'api.list_alarms(boolean,integer)',
      'api.alarms_due_mail(integer)',
      'api.record_alarm_notice(uuid,text)',
      'api.alarm_observations()',
      'api.record_heartbeat(text,text)',
      'api.create_project_request(uuid,bigint,uuid,text,text,text,text,text,text,text,text,text,boolean,text)',
      'api.read_project_request(uuid,bigint,uuid)',
      'api.record_picture_set(uuid,bigint,uuid,uuid,text,uuid[])',
      'api.release_staged_pictures(uuid,bigint,uuid[])',
      'api.record_picture_review(uuid,bigint,uuid,uuid,integer,text,text,text,jsonb,boolean,boolean)',
      'api.check_picture_retention(uuid,bigint,uuid,integer,uuid[])',
      'api.read_retained_pictures(uuid,bigint,uuid)',
      'api.set_usage_limit(text,uuid,bigint,uuid,uuid,text,bigint,integer)',
      'api.list_usage(uuid,bigint)',
      'api.record_usage_refusal(uuid,text,uuid)',
      'api.accept_job(uuid,bigint,uuid,uuid,text,text)',
      'api.begin_step(uuid,bigint,uuid,uuid,text,integer)',
      'api.advance_operation(uuid,bigint,uuid,uuid,text,text)',
      'api.move_attempt(uuid,bigint,uuid,uuid,text,text)',
      'api.request_retry(uuid,bigint,uuid,uuid,integer,text)',
      'api.read_job(uuid,bigint,uuid)',
      'api.quote_cost(uuid,bigint,uuid,text,text,text,bigint,integer,integer,integer,jsonb)',
      'api.reserve_cost(uuid,bigint,uuid,uuid,uuid,text,text,text,bigint,integer,integer,jsonb)',
      'api.settle_cost(uuid,uuid,uuid,text,bigint,bigint,text)',
      'api.grant_provider_permission(uuid,uuid,uuid,text,text,text,text[],bigint)',
      'api.get_provider_permission(uuid,uuid,uuid,text,text)',
      'api.revoke_provider_permission(uuid,uuid,uuid,uuid)',
      'api.reserve_cost(uuid,bigint,uuid,uuid,uuid,text,text,text,bigint,integer,integer,jsonb,uuid,uuid,uuid,text,text,text[])',
      'api.submit_job(uuid,bigint,uuid,uuid,text,text,jsonb,integer)',
      'api.cancel_job(uuid,bigint,uuid,uuid)',
      'api.list_jobs(uuid,bigint,integer)',
      'api.read_job_detail(uuid,bigint,uuid)',
      'api.register_worker(text,text,integer,text,text[])',
      'api.claim_attempt(uuid,uuid,text)',
      'api.renew_lease(uuid,uuid)',
      'api.run_step(uuid,uuid,text,integer)',
      'api.finish_operation(uuid,uuid,uuid,text,bigint,bigint,text,text)',
      'api.finish_attempt(uuid,uuid,text,text,bigint)',
      'api.record_callback(text,text,text,text,text,uuid,text)',
      'api.claim_outbox(integer,uuid)',
      'api.mark_published(uuid,text)',
      'api.sweep_attempts()',
      'api.cancel_account_jobs(uuid)',
      'api.reconcile_operation(uuid,text,bigint,bigint,text,text)',
      'api.list_overrun_incidents(uuid,bigint,integer)',
      'api.clear_overrun_incident(uuid,bigint,uuid,uuid)'
    ]) as f(signature)
   where not has_function_privilege('service_role', f.signature, 'execute');
  if v_missing is not null then
    raise exception 'api.preflight: the service role cannot execute %', v_missing using errcode = '42501';
  end if;

  if not has_table_privilege('auth.sessions', 'DELETE') then
    raise exception 'api.preflight: permission denied to end Auth sessions (delete on auth.sessions)' using errcode = '42501';
  end if;
  if not has_table_privilege('auth.users', 'DELETE') then
    raise exception 'api.preflight: permission denied to delete Auth identities (delete on auth.users)' using errcode = '42501';
  end if;

  -- Last, after every check of what the owner may read and delete: the bucket is read through row-level security (storage.buckets has it on), so a
  -- role that is not the migration's owner (the tests hand the function to one, to see each privilege check fire) sees no row here, and this check
  -- must not hide the ones before it.
  if not exists (select 1 from storage.buckets b where b.id = 'private-files' and b.public = false) then
    raise exception 'api.preflight: the private-files bucket is missing or public (the Story 1.12 migration creates it private)' using errcode = 'N3020';
  end if;

  v_result.ok := true;
  return v_result;
end;
$$;

comment on function api.preflight() is
  'Reads identity.session_grants (including its CSRF columns), identity.accounts (including its status handle), identity.account_preferences, identity.step_up_nonces, identity.fresh_authentications (including source), identity.recovery_tokens, projects.projects, projects.project_commands, projects.request_revisions (including the review columns), projects.request_images (including the labels and measurements and the retained pins), lifecycle.tombstones, lifecycle.ledger_outbox, lifecycle.ledger_relay, lifecycle.status_requests, lifecycle.job_receipts, the six artifacts tables and the artifacts.session_authority, artifacts.instance and artifacts.retained_pictures views, lifecycle.alarms, lifecycle.alarm_notices, lifecycle.heartbeats, usage.periods, jobs.jobs, jobs.attempts, jobs.steps, jobs.operations, jobs.commands, usage.rate_schedules, usage.reservations, usage.settlements, usage.overrun_incidents, usage.commands, provider_private.permissions, jobs.outbox, jobs.workers, jobs.leases, jobs.callbacks, usage.corrections, auth.sessions, auth.identities and auth.mfa_amr_claims (one row each at most), checks that the Story 1.5, 1.6, 1.7, 1.8, 1.9, 1.12, 1.13, 2.1, 2.2, 2.3, 2.12, 2.4, 2.11, 2.6, 2.5, 2.7 and 2.8 functions exist and are executable by the service role, that the private-files bucket exists and is private, and that the owner may delete from auth.sessions and auth.users, and answers ok. Read-only.';

-- Access ------------------------------------------------------------------------------------------------------------------------------------

revoke all on all tables in schema usage from public, anon, authenticated, service_role;
revoke all on all functions in schema usage from public, anon, authenticated, service_role;
revoke all on all tables in schema jobs from public, anon, authenticated, service_role;
revoke all on all functions in schema jobs from public, anon, authenticated, service_role;

-- Closed by default; only the service role is let in, by name. (create or replace keeps the grants the re-created functions already had.)
grant execute on function api.reconcile_operation(uuid, text, bigint, bigint, text, text) to service_role;
grant execute on function api.list_overrun_incidents(uuid, bigint, integer) to service_role;
grant execute on function api.clear_overrun_incident(uuid, bigint, uuid, uuid) to service_role;

-- New functions and types: have the Data API reload its schema cache now.
notify pgrst, 'reload schema';
