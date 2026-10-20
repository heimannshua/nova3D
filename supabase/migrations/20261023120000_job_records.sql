-- Story 2.11: create durable Job, attempt, step and operation identities.
--
-- Nothing recorded background work. Stories 2.6 to 2.8 reserve, run and reconcile paid work, and need a unique identity for every Job, every attempt, every step
-- and every external operation, so that a duplicate command cannot duplicate work or a charge, and a retry cannot start while an earlier charge is unresolved.
-- This migration is the record of that: a Jobs-owned closed schema `jobs` with the four record families, an immutable table of command receipts, six narrow
-- `api` commands, forward-only guarded states, and ONE derived public state. There is no screen, no dispatch, no reservation and no worker yet.
--
--   jobs (schema)               new, closed like usage, identity, projects and artifacts: row-level security on, no policy, every privilege revoked from public,
--                               anon, authenticated and service_role, and not exposed by the Data API. `api` stays functions only.
--   jobs.jobs                   one row for each Job: its Account, its Project (composite foreign key to projects.projects), its kind. A Job has NO state column:
--                               its state is its highest attempt's. Update and truncate are refused.
--   jobs.attempts               Job -> attempt: `number` from 1, linked to the previous attempt (null only for 1), the input digest it pins, its state (`waiting`,
--                               `running`, `completed`, `failed`, `cancelled`), stage, stored reason and times. At most one attempt of a Job is open (waiting or
--                               running). Truncate is refused, and so is every update but a guarded move; a finished attempt is never changed.
--   jobs.steps                  attempt -> step: unique by (attempt, step key). Update and truncate are refused.
--   jobs.operations             step -> operation: unique by (step, ordinal), its state (`planned`, `dispatched`, `completed`, `ambiguous`, `noncharge`,
--                               `settled`, `abandoned`), the provider request ID, and the times. Truncate is refused, and so is every update but a guarded move.
--   jobs.commands               the immutable receipt of each command: Account, command ID, kind, digest, subject. Update and truncate are refused.
--   jobs.charge_open            internal, THE GATE: true when any operation of any attempt of the Job numbered below a number is potentially chargeable
--                               (`dispatched` or `ambiguous`). A retry is only ever started past this gate, and it looks at every earlier attempt, so a new attempt
--                               number gains nothing.
--   jobs.public_state           internal: the Job's highest attempt's (state, stage, reason): the stored values, except a `waiting` attempt's reason, which is
--                               derived (`awaiting_reconciliation` while the gate is closed for its number, else `awaiting_dispatch`).
--   api.accept_job              creates a Job and attempt 1 (`waiting`, stage `accepted`).
--   api.begin_step              creates a step, and with an ordinal its `planned` operation, in a `running` attempt; what exists is returned, never recreated.
--   api.advance_operation       moves an operation along its guarded states.
--   api.move_attempt            starts, completes, fails or cancels an attempt.
--   api.request_retry           creates attempt number+1 after a `failed` attempt; never waits, never starts it, never retries by itself.
--   api.read_job                the Job, its public state, whether it can be retried, and its attempts.
--   api.preflight               re-created carrying every earlier probe and the new ones (forty-seven `api` functions in all).
--
-- The five writes take the Account, its epoch and a command ID, and run in this order, and nothing is written before all of it passes:
--   1. the arguments (a shape the application would never send raises 22023);
--   2. identity.assert_operation_authority, which also refuses a tombstoned Account (a refusal, N3010, answers `denied`);
--   3. the advisory lock `nova3d:jobs-command:<account>:<command>`: one command ID at a time;
--   4. the subject belongs to the Account, and its Project row is held FOR SHARE, not deleted and not tombstoned (`unavailable`: ONE answer for a foreign, a
--      deleted, an unknown and a tombstoned subject). api.record_tombstone takes the same row FOR UPDATE, so a step can never land after a tombstone;
--   5. the advisory lock `nova3d:job:<job>`: one command at a time for a Job, so a retry and a reconcile are never in flight together;
--   6. the receipt, by (Account, command ID): the same digest replays (`replayed`, the original records), another is `reused`;
--   7. the command's own checks, replays and gates BEFORE state checks, so a lost answer always replays.
-- The digest is SHA-256 over the kind and every argument the caller supplied except the Account, the epoch and the command ID (projects.length_prefixed). Every
-- command that answers `replayed` or does its work leaves a jobs.commands row, so a second command ID that finds the work already done is recorded and replays too.
--
-- Stable error codes: 22023 (arguments), 55000 (a guarded row refuses a change), 23514 (a row is not shaped as the family requires).
--
-- Same pattern as the earlier migrations: the functions in `api` run as the table owner with an empty search_path, are closed by default (the default-privileges
-- rules of 20261010120000_accounts.sql) and granted to service_role by name at the end; the functions in `jobs` are callable by no API role at all.

-- The schema, closed by default -----------------------------------------------------------------------------------------------------

create schema jobs;

comment on schema jobs is 'Story 2.11. Jobs, attempts, steps, operations and the receipts of their commands. Not exposed; reached only through api functions.';

revoke all on schema jobs from public, anon, authenticated, service_role;

alter default privileges for role postgres in schema jobs revoke execute on functions from public, anon, authenticated, service_role;
alter default privileges for role postgres in schema jobs revoke all on tables from public, anon, authenticated, service_role;
alter default privileges for role postgres in schema jobs revoke all on sequences from public, anon, authenticated, service_role;

-- Refuses a change to a record that is never changed (and a truncate of any of them).
create function jobs.refuse_change() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'jobs.%: a record is not edited or emptied', tg_table_name using errcode = '55000';
end;
$$;

-- The Jobs ------------------------------------------------------------------------------------------------------------------------------

create table jobs.jobs (
  id uuid primary key default gen_random_uuid(),
  -- RESTRICT: an Account that has Jobs cannot be deleted by accident; the Epic 8 purge removes them first.
  account_id uuid not null references identity.accounts (id) on delete restrict,
  project_id uuid not null,
  -- What the Job is for. Open on purpose: the stories that own a kind of work name it.
  kind text not null check (kind ~ '^[a-z][a-z0-9_]{0,39}$'),
  created_at timestamptz not null default clock_timestamp(),
  -- Ownership: a Job is its Account's own Project's. A Job names no other Account's Project.
  constraint jobs_project_fkey foreign key (project_id, account_id) references projects.projects (id, account_id) on delete restrict,
  constraint jobs_id_account_key unique (id, account_id)
);

comment on table jobs.jobs is
  'The Jobs of Accounts (Story 2.11), one row each, never edited. A Job has no state of its own: its state is its highest attempt''s (jobs.public_state). Delete is left for the Epic 8 purge.';

create index jobs_project_idx on jobs.jobs (project_id, account_id);

create trigger jobs_no_update before update on jobs.jobs
  for each row execute function jobs.refuse_change();
create trigger jobs_no_truncate before truncate on jobs.jobs
  for each statement execute function jobs.refuse_change();

-- The attempts ----------------------------------------------------------------------------------------------------------------------------

create table jobs.attempts (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null,
  job_id uuid not null,
  -- 1 for the first attempt; a retry is the next number, linked to the attempt before it.
  number integer not null check (number >= 1),
  previous_attempt_id uuid,
  -- What the attempt pins to run on: SHA-256 (hex), set when the attempt is created and never changed.
  input_digest text not null check (input_digest ~ '^[0-9a-f]{64}$'),
  state text not null check (state in ('waiting', 'running', 'completed', 'failed', 'cancelled')),
  -- `accepted` at attempt 1, `retry` at a later attempt, `started` when it starts, a step key when a step is begun; left as it was when the attempt ends.
  stage text not null check (stage ~ '^[a-z][a-z0-9_]{0,39}$'),
  -- The STORED reason: null while the attempt is open or completed. A waiting attempt's reason is derived, never stored (jobs.public_state).
  reason text check (reason in ('step_failed', 'lease_lost', 'user_cancelled', 'account_disabled')),
  created_at timestamptz not null default clock_timestamp(),
  started_at timestamptz,
  ended_at timestamptz,
  constraint attempts_job_fkey foreign key (job_id, account_id) references jobs.jobs (id, account_id) on delete restrict,
  -- The previous attempt is of the same Job and Account. (NO ACTION, checked at the end of a statement, so the purge can remove a Job's attempts in one statement.)
  constraint attempts_previous_fkey foreign key (previous_attempt_id, job_id, account_id) references jobs.attempts (id, job_id, account_id),
  constraint attempts_id_job_account_key unique (id, job_id, account_id),
  constraint attempts_id_account_key unique (id, account_id),
  constraint attempts_job_number_key unique (job_id, number),
  constraint attempts_previous_shape check ((previous_attempt_id is null) = (number = 1)),
  constraint attempts_reason_shape check (
    case state
      when 'failed' then reason is not null and reason in ('step_failed', 'lease_lost')
      when 'cancelled' then reason is not null and reason in ('user_cancelled', 'account_disabled')
      else reason is null
    end
  ),
  constraint attempts_time_shape check (
    (state = 'waiting' and started_at is null and ended_at is null)
    or (state = 'running' and started_at is not null and ended_at is null)
    or (state in ('completed', 'failed') and started_at is not null and ended_at is not null)
    or (state = 'cancelled' and ended_at is not null)
  )
);

comment on table jobs.attempts is
  'The attempts of Jobs (Story 2.11): number from 1, linked to the attempt before it, forward-only states, the stored reason. A Job has at most one open (waiting or running) attempt; a finished attempt is never changed. Truncate is refused; delete is left for the Epic 8 purge.';

-- A Job has at most one open attempt.
create unique index attempts_one_open_key on jobs.attempts (job_id) where state in ('waiting', 'running');

-- An attempt is appended to its Job: attempt 1 first, then the next number linked to a FAILED attempt; always waiting, never started.
create function jobs.check_attempt() returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_latest jobs.attempts;
begin
  if new.state <> 'waiting' or new.reason is not null or new.started_at is not null or new.ended_at is not null then
    raise exception 'jobs.attempts: an attempt is created waiting' using errcode = '23514';
  end if;
  select * into v_latest from jobs.attempts a where a.job_id = new.job_id order by a.number desc limit 1;
  if not found then
    if new.number <> 1 or new.stage <> 'accepted' then
      raise exception 'jobs.attempts: the first attempt of a Job is number 1, at stage accepted' using errcode = '23514';
    end if;
  else
    if new.number <> v_latest.number + 1 or new.previous_attempt_id is distinct from v_latest.id or new.stage <> 'retry' then
      raise exception 'jobs.attempts: a later attempt is the next number, linked to the attempt before it, at stage retry' using errcode = '23514';
    end if;
    if v_latest.state <> 'failed' then
      raise exception 'jobs.attempts: only a failed attempt is followed by another' using errcode = '23514';
    end if;
  end if;
  return new;
end;
$$;

create trigger attempts_check before insert on jobs.attempts
  for each row execute function jobs.check_attempt();

-- The only changes an attempt allows: the stage of a running attempt, and the guarded moves
--   waiting -> running | cancelled      running -> completed | failed | cancelled
-- An identity column never changes, a finished attempt never changes, and a time is written once. A move to `running` sets the stage `started`; a move
-- that ends the attempt leaves the stage as it was.
create function jobs.guard_attempt_change() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.id is distinct from old.id or new.account_id is distinct from old.account_id or new.job_id is distinct from old.job_id
     or new.number is distinct from old.number or new.previous_attempt_id is distinct from old.previous_attempt_id
     or new.input_digest is distinct from old.input_digest or new.created_at is distinct from old.created_at then
    raise exception 'jobs.attempts: an identity column is not changed' using errcode = '55000';
  end if;
  if old.state in ('completed', 'failed', 'cancelled') then
    raise exception 'jobs.attempts: a finished attempt is not changed' using errcode = '55000';
  end if;
  if (old.started_at is not null and new.started_at is distinct from old.started_at) or (old.ended_at is not null and new.ended_at is distinct from old.ended_at) then
    raise exception 'jobs.attempts: a time is written once' using errcode = '55000';
  end if;
  if new.state = old.state then
    if old.state <> 'running' or new.reason is distinct from old.reason or new.started_at is distinct from old.started_at or new.ended_at is distinct from old.ended_at then
      raise exception 'jobs.attempts: only the stage of a running attempt changes without a move' using errcode = '55000';
    end if;
    return new;
  end if;
  if (old.state, new.state) not in (('waiting', 'running'), ('waiting', 'cancelled'), ('running', 'completed'), ('running', 'failed'), ('running', 'cancelled')) then
    raise exception 'jobs.attempts: % to % is not a move', old.state, new.state using errcode = '55000';
  end if;
  if new.state = 'running' then
    if new.stage <> 'started' then
      raise exception 'jobs.attempts: a started attempt is at stage started' using errcode = '55000';
    end if;
  elsif new.stage is distinct from old.stage then
    raise exception 'jobs.attempts: the stage is left as it was when the attempt ends' using errcode = '55000';
  end if;
  return new;
end;
$$;

create trigger attempts_guard before update on jobs.attempts
  for each row execute function jobs.guard_attempt_change();
create trigger attempts_no_truncate before truncate on jobs.attempts
  for each statement execute function jobs.refuse_change();

-- The steps -------------------------------------------------------------------------------------------------------------------------------

create table jobs.steps (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null,
  attempt_id uuid not null,
  step_key text not null check (step_key ~ '^[a-z][a-z0-9_]{0,39}$'),
  created_at timestamptz not null default clock_timestamp(),
  constraint steps_attempt_fkey foreign key (attempt_id, account_id) references jobs.attempts (id, account_id) on delete restrict,
  -- One step of an attempt for a logical step key.
  constraint steps_attempt_key_key unique (attempt_id, step_key),
  constraint steps_id_account_key unique (id, account_id)
);

comment on table jobs.steps is
  'The steps of attempts (Story 2.11), one for each (attempt, step key), never edited. Delete is left for the Epic 8 purge.';

-- A step is only ever added to a RUNNING attempt: a finished or waiting attempt is not extended.
create function jobs.check_step() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if not exists (select 1 from jobs.attempts a where a.id = new.attempt_id and a.state = 'running') then
    raise exception 'jobs.steps: a step is added to a running attempt' using errcode = '23514';
  end if;
  return new;
end;
$$;

create trigger steps_check before insert on jobs.steps
  for each row execute function jobs.check_step();
create trigger steps_no_update before update on jobs.steps
  for each row execute function jobs.refuse_change();
create trigger steps_no_truncate before truncate on jobs.steps
  for each statement execute function jobs.refuse_change();

-- The operations --------------------------------------------------------------------------------------------------------------------------

create table jobs.operations (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null,
  step_id uuid not null,
  ordinal integer not null check (ordinal between 1 and 100),
  state text not null check (state in ('planned', 'dispatched', 'completed', 'ambiguous', 'noncharge', 'settled', 'abandoned')),
  -- The provider's request ID, once known: printable ASCII without spaces. Written once, never changed.
  request_id text check (request_id ~ '^[!-~]{1,200}$'),
  created_at timestamptz not null default clock_timestamp(),
  -- When it was dispatched (the move out of `planned`).
  dispatched_at timestamptz,
  -- When its outcome was first recorded (the first move out of `dispatched`: completed, ambiguous or noncharge). Later reconciliation does not rewrite it.
  outcome_at timestamptz,
  constraint operations_step_fkey foreign key (step_id, account_id) references jobs.steps (id, account_id) on delete restrict,
  -- One operation of a step for an ordinal.
  constraint operations_step_ordinal_key unique (step_id, ordinal),
  constraint operations_time_shape check (
    (state in ('planned', 'abandoned') and dispatched_at is null and outcome_at is null)
    or (state = 'dispatched' and dispatched_at is not null and outcome_at is null)
    or (state in ('completed', 'ambiguous', 'noncharge', 'settled') and dispatched_at is not null and outcome_at is not null)
  ),
  -- A pre-processing rejection is only noncharge with the provider's request ID to show for it.
  constraint operations_noncharge_request check (state <> 'noncharge' or request_id is not null)
);

comment on table jobs.operations is
  'The external operations of steps (Story 2.11), one for each (step, ordinal): forward-only states, potentially chargeable while dispatched or ambiguous. Truncate is refused; delete is left for the Epic 8 purge.';

-- An operation is created `planned`, in a running attempt.
create function jobs.check_operation() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.state <> 'planned' or new.request_id is not null then
    raise exception 'jobs.operations: an operation is created planned' using errcode = '23514';
  end if;
  if not exists (select 1 from jobs.steps s join jobs.attempts a on a.id = s.attempt_id where s.id = new.step_id and a.state = 'running') then
    raise exception 'jobs.operations: an operation is added to a running attempt' using errcode = '23514';
  end if;
  return new;
end;
$$;

create trigger operations_check before insert on jobs.operations
  for each row execute function jobs.check_operation();

-- The only change an operation allows is a guarded move
--   planned -> dispatched | abandoned      dispatched -> completed | ambiguous | noncharge      ambiguous -> settled | noncharge
-- An identity column never changes, a terminal operation never changes, and the times and the request ID are written once. A dispatch needs a running attempt;
-- every other move works in any attempt state, so the late outcome of an attempt that has ended is still recorded.
create function jobs.guard_operation_change() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.id is distinct from old.id or new.account_id is distinct from old.account_id or new.step_id is distinct from old.step_id
     or new.ordinal is distinct from old.ordinal or new.created_at is distinct from old.created_at then
    raise exception 'jobs.operations: an identity column is not changed' using errcode = '55000';
  end if;
  if old.state in ('completed', 'noncharge', 'settled', 'abandoned') then
    raise exception 'jobs.operations: a finished operation is not changed' using errcode = '55000';
  end if;
  if (old.dispatched_at is not null and new.dispatched_at is distinct from old.dispatched_at)
     or (old.outcome_at is not null and new.outcome_at is distinct from old.outcome_at)
     or (old.request_id is not null and new.request_id is distinct from old.request_id) then
    raise exception 'jobs.operations: a time and the request ID are written once' using errcode = '55000';
  end if;
  if (old.state, new.state) not in (
       ('planned', 'dispatched'), ('planned', 'abandoned'), ('dispatched', 'completed'), ('dispatched', 'ambiguous'), ('dispatched', 'noncharge'),
       ('ambiguous', 'settled'), ('ambiguous', 'noncharge')) then
    raise exception 'jobs.operations: % to % is not a move', old.state, new.state using errcode = '55000';
  end if;
  if old.state = 'planned' and new.state = 'dispatched'
     and not exists (select 1 from jobs.steps s join jobs.attempts a on a.id = s.attempt_id where s.id = old.step_id and a.state = 'running') then
    raise exception 'jobs.operations: only a running attempt dispatches' using errcode = '55000';
  end if;
  return new;
end;
$$;

create trigger operations_guard before update on jobs.operations
  for each row execute function jobs.guard_operation_change();
create trigger operations_no_truncate before truncate on jobs.operations
  for each statement execute function jobs.refuse_change();

-- The receipts ----------------------------------------------------------------------------------------------------------------------------

create table jobs.commands (
  account_id uuid not null references identity.accounts (id) on delete restrict,
  command_id uuid not null,
  kind text not null check (kind in ('accept_job', 'begin_step', 'advance_operation', 'move_attempt', 'request_retry')),
  -- SHA-256 (hex) of the kind and what the caller supplied (jobs.command_digest): what "the same command" means.
  digest text not null check (digest ~ '^[0-9a-f]{64}$'),
  -- The record the command made or found: the Job (accept), the step (begin), the operation (advance), the attempt (move) or the new attempt (retry).
  subject_id uuid not null,
  created_at timestamptz not null default clock_timestamp(),
  primary key (account_id, command_id)
);

comment on table jobs.commands is
  'The immutable receipts of the Job commands (Story 2.11): one row for each (Account, command ID) that did its work or replayed. Never edited. Delete is left for the Epic 8 purge.';

create trigger commands_no_update before update on jobs.commands
  for each row execute function jobs.refuse_change();
create trigger commands_no_truncate before truncate on jobs.commands
  for each statement execute function jobs.refuse_change();

-- Closed by default ----------------------------------------------------------------------------------------------------------------------

alter table jobs.jobs enable row level security;
alter table jobs.attempts enable row level security;
alter table jobs.steps enable row level security;
alter table jobs.operations enable row level security;
alter table jobs.commands enable row level security;
-- No policy: only the owner and roles that bypass RLS can read a row, and the privileges below leave anon, authenticated and service_role no path to the
-- tables at all.
revoke all on jobs.jobs from public, anon, authenticated, service_role;
revoke all on jobs.attempts from public, anon, authenticated, service_role;
revoke all on jobs.steps from public, anon, authenticated, service_role;
revoke all on jobs.operations from public, anon, authenticated, service_role;
revoke all on jobs.commands from public, anon, authenticated, service_role;

-- The gate and the public state (internal) ---------------------------------------------------------------------------------------------------

-- THE GATE. True when any operation of any attempt of the Job numbered BELOW `p_before_number` is potentially chargeable: dispatched, or ambiguous. It looks
-- at every earlier attempt, so no number change, and no third attempt, passes it. Reconciled or terminal operations (completed, noncharge, settled, abandoned)
-- are not chargeable. STABLE on purpose: a call reads the rows as of the snapshot of the statement that calls it (a command asks it in a statement of its own, after
-- it holds the Job's lock, so it sees what the last command committed; api.read_job asks it inside the one statement that reads the Job, so the answer and the
-- rows it was derived from are one snapshot). A volatile function would take a snapshot of its own for each call, and the two could differ.
create function jobs.charge_open(p_job_id uuid, p_before_number integer) returns boolean
language sql
stable
set search_path = ''
as $$
  select exists (
    select 1
      from jobs.attempts a
      join jobs.steps s on s.attempt_id = a.id
      join jobs.operations o on o.step_id = s.id
     where a.job_id = p_job_id and a.number < p_before_number and o.state in ('dispatched', 'ambiguous')
  )
$$;

comment on function jobs.charge_open(uuid, integer) is
  'The gate: true when an operation of any attempt of the Job numbered below the given number is potentially chargeable (dispatched or ambiguous). Callable by no API role.';

-- The reason an attempt shows: the stored one, except for a waiting attempt, whose reason is derived from the gate.
create function jobs.derived_reason(p_job_id uuid, p_number integer, p_state text, p_reason text) returns text
language sql
stable
set search_path = ''
as $$
  select case
    when p_state = 'waiting' then case when jobs.charge_open(p_job_id, p_number) then 'awaiting_reconciliation' else 'awaiting_dispatch' end
    else p_reason
  end
$$;

comment on function jobs.derived_reason(uuid, integer, text, text) is
  'The reason an attempt shows: stored, except a waiting attempt''s, which is awaiting_reconciliation while the gate is closed for its number, else awaiting_dispatch. Callable by no API role.';

-- The public state of a Job: its highest attempt's (state, stage, reason). The Job has no state column, so these cannot disagree with the records.
create function jobs.public_state(p_job_id uuid) returns table (state text, stage text, reason text)
language sql
stable
set search_path = ''
as $$
  select a.state, a.stage, jobs.derived_reason(a.job_id, a.number, a.state, a.reason)
    from jobs.attempts a
   where a.job_id = p_job_id
   order by a.number desc
   limit 1
$$;

comment on function jobs.public_state(uuid) is
  'The public state of a Job: its highest attempt''s state, stage and reason (a waiting attempt''s reason is derived). Callable by no API role.';

-- The Project of a Job's subject, held: the row FOR SHARE (api.record_tombstone takes it FOR UPDATE, so a write and a tombstone are serial), live, and without a
-- tombstone. False for a Project that is another Account's, deleted, unknown or tombstoned: one answer.
create function jobs.hold_project(p_account_id uuid, p_project_id uuid) returns boolean
language plpgsql
set search_path = ''
as $$
begin
  perform 1
    from projects.projects p
   where p.id = p_project_id and p.account_id = p_account_id and p.deleted_at is null
     for share;
  if not found then
    return false;
  end if;
  return not lifecycle.is_tombstoned('project', p_project_id);
end;
$$;

comment on function jobs.hold_project(uuid, uuid) is
  'Holds the Account''s live Project FOR SHARE and answers false unless it exists, is the Account''s, is not deleted and has no tombstone. Callable by no API role.';

-- What a command asked for: SHA-256 (hex) over the kind and every argument the caller supplied (the Account, the epoch and the command ID excepted), each
-- length-prefixed, an absent argument a dash.
create function jobs.command_digest(p_kind text, p_arguments text[]) returns text
language sql
stable
set search_path = ''
as $$
  select encode(sha256(convert_to(
    projects.length_prefixed(p_kind)
    || coalesce((select string_agg(projects.length_prefixed(x.argument), '' order by x.position) from unnest(p_arguments) with ordinality as x(argument, position)), ''),
    'UTF8')), 'hex')
$$;

comment on function jobs.command_digest(text, text[]) is
  'SHA-256 (hex) over the length-prefixed kind and arguments of a Job command. Callable by no API role.';

-- The receipt of a command that did its work or replayed.
create function jobs.record_command(p_account_id uuid, p_command_id uuid, p_kind text, p_digest text, p_subject_id uuid) returns void
language plpgsql
set search_path = ''
as $$
begin
  insert into jobs.commands (account_id, command_id, kind, digest, subject_id) values (p_account_id, p_command_id, p_kind, p_digest, p_subject_id);
end;
$$;

comment on function jobs.record_command(uuid, uuid, text, text, uuid) is
  'Writes the receipt of a Job command. The only writer of jobs.commands. Callable by no API role.';

-- The command: accept ----------------------------------------------------------------------------------------------------------------------

-- outcome: created | replayed | reused | denied | unavailable. The Job and attempt 1 are set for created and replayed (replayed carries attempt 1 as it is now).
create type api.job_acceptance as (
  outcome text,
  job_id uuid,
  attempt_id uuid,
  attempt_number integer,
  state text,
  stage text,
  reason text
);

create function api.accept_job(p_account_id uuid, p_epoch bigint, p_command_id uuid, p_project_id uuid, p_kind text, p_input_digest text)
returns api.job_acceptance
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_result api.job_acceptance;
  v_digest text;
  v_command jobs.commands;
  v_job jobs.jobs;
  v_attempt jobs.attempts;
begin
  -- 1. The arguments.
  if p_account_id is null or p_epoch is null or p_epoch < 1 or p_command_id is null or p_project_id is null
     or p_kind is null or p_kind !~ '^[a-z][a-z0-9_]{0,39}$'
     or p_input_digest is null or p_input_digest !~ '^[0-9a-f]{64}$' then
    raise exception 'invalid argument' using errcode = '22023';
  end if;

  -- 2. The authority (this takes the Account's row FOR SHARE until the end of the transaction).
  begin
    perform identity.assert_operation_authority(p_account_id, p_epoch);
  exception when sqlstate 'N3010' then
    v_result.outcome := 'denied';
    return v_result;
  end;

  -- 3. One command ID at a time for an Account.
  perform pg_advisory_xact_lock(hashtextextended('nova3d:jobs-command:' || p_account_id::text || ':' || p_command_id::text, 0));

  -- 4. The subject is a Project of the Account's, held FOR SHARE, live and without a tombstone.
  if not jobs.hold_project(p_account_id, p_project_id) then
    v_result.outcome := 'unavailable';
    return v_result;
  end if;

  -- 5. (There is no Job to lock yet: a new Job is its own, and two command IDs make two Jobs.)

  -- 6. The receipt.
  v_digest := jobs.command_digest('accept_job', array[p_project_id::text, p_kind, p_input_digest]);
  select * into v_command from jobs.commands c where c.account_id = p_account_id and c.command_id = p_command_id;
  if found then
    if v_command.digest <> v_digest or v_command.kind <> 'accept_job' then
      v_result.outcome := 'reused';
      return v_result;
    end if;
    select * into v_attempt from jobs.attempts a where a.job_id = v_command.subject_id and a.number = 1;
    v_result.outcome := 'replayed';
    v_result.job_id := v_attempt.job_id;
    v_result.attempt_id := v_attempt.id;
    v_result.attempt_number := v_attempt.number;
    v_result.state := v_attempt.state;
    v_result.stage := v_attempt.stage;
    v_result.reason := jobs.derived_reason(v_attempt.job_id, v_attempt.number, v_attempt.state, v_attempt.reason);
    return v_result;
  end if;

  -- 7. The Job and its first attempt, waiting, and the receipt.
  insert into jobs.jobs (account_id, project_id, kind) values (p_account_id, p_project_id, p_kind) returning * into v_job;
  insert into jobs.attempts (account_id, job_id, number, previous_attempt_id, input_digest, state, stage)
    values (p_account_id, v_job.id, 1, null, p_input_digest, 'waiting', 'accepted')
    returning * into v_attempt;
  perform jobs.record_command(p_account_id, p_command_id, 'accept_job', v_digest, v_job.id);

  v_result.outcome := 'created';
  v_result.job_id := v_job.id;
  v_result.attempt_id := v_attempt.id;
  v_result.attempt_number := v_attempt.number;
  v_result.state := v_attempt.state;
  v_result.stage := v_attempt.stage;
  v_result.reason := jobs.derived_reason(v_job.id, v_attempt.number, v_attempt.state, v_attempt.reason);
  return v_result;
end;
$$;

comment on function api.accept_job(uuid, bigint, uuid, uuid, text, text) is
  'Creates a Job for a live Project of the Account and its attempt 1 (waiting, stage accepted, reason awaiting_dispatch). Account, epoch, command ID, typed payload. created | replayed | reused | denied | unavailable. No reservation, dispatch or worker: Stories 2.6 and 2.7.';

-- The command: begin a step ----------------------------------------------------------------------------------------------------------------

-- outcome: created | replayed | reused | denied | unavailable | not_running. step_id and operation_id (null without an ordinal) are set for created and
-- replayed; attempt_state is the attempt's state now (for not_running, the state that refused).
create type api.step_beginning as (
  outcome text,
  step_id uuid,
  operation_id uuid,
  attempt_state text
);

create function api.begin_step(p_account_id uuid, p_epoch bigint, p_command_id uuid, p_attempt_id uuid, p_step_key text, p_ordinal integer default null)
returns api.step_beginning
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_result api.step_beginning;
  v_job_id uuid;
  v_project_id uuid;
  v_digest text;
  v_command jobs.commands;
  v_attempt jobs.attempts;
  v_step jobs.steps;
  v_operation jobs.operations;
begin
  -- 1. The arguments.
  if p_account_id is null or p_epoch is null or p_epoch < 1 or p_command_id is null or p_attempt_id is null
     or p_step_key is null or p_step_key !~ '^[a-z][a-z0-9_]{0,39}$'
     or (p_ordinal is not null and p_ordinal not between 1 and 100) then
    raise exception 'invalid argument' using errcode = '22023';
  end if;

  -- 2. The authority.
  begin
    perform identity.assert_operation_authority(p_account_id, p_epoch);
  exception when sqlstate 'N3010' then
    v_result.outcome := 'denied';
    return v_result;
  end;

  -- 3. One command ID at a time for an Account.
  perform pg_advisory_xact_lock(hashtextextended('nova3d:jobs-command:' || p_account_id::text || ':' || p_command_id::text, 0));

  -- 4. The subject: an attempt of the Account's, and its Project held FOR SHARE, live and without a tombstone.
  select a.job_id, j.project_id into v_job_id, v_project_id
    from jobs.attempts a
    join jobs.jobs j on j.id = a.job_id and j.account_id = a.account_id
   where a.id = p_attempt_id and a.account_id = p_account_id;
  if not found or not jobs.hold_project(p_account_id, v_project_id) then
    v_result.outcome := 'unavailable';
    return v_result;
  end if;

  -- 5. One command at a time for a Job.
  perform pg_advisory_xact_lock(hashtextextended('nova3d:job:' || v_job_id::text, 0));

  -- 6. The receipt: what this command ID found or made.
  v_digest := jobs.command_digest('begin_step', array[p_attempt_id::text, p_step_key, p_ordinal::text]);
  select * into v_command from jobs.commands c where c.account_id = p_account_id and c.command_id = p_command_id;
  select * into v_attempt from jobs.attempts a where a.id = p_attempt_id;
  if v_command.command_id is not null then
    if v_command.digest <> v_digest or v_command.kind <> 'begin_step' then
      v_result.outcome := 'reused';
      return v_result;
    end if;
    v_result.outcome := 'replayed';
    v_result.step_id := v_command.subject_id;
    if p_ordinal is not null then
      select o.id into v_result.operation_id from jobs.operations o where o.step_id = v_command.subject_id and o.ordinal = p_ordinal;
    end if;
    v_result.attempt_state := v_attempt.state;
    return v_result;
  end if;

  -- 7. What exists is returned and never recreated, whatever the attempt's state.
  select * into v_step from jobs.steps s where s.attempt_id = p_attempt_id and s.step_key = p_step_key;
  if v_step.id is not null and p_ordinal is not null then
    select * into v_operation from jobs.operations o where o.step_id = v_step.id and o.ordinal = p_ordinal;
  end if;
  if v_step.id is not null and (p_ordinal is null or v_operation.id is not null) then
    perform jobs.record_command(p_account_id, p_command_id, 'begin_step', v_digest, v_step.id);
    v_result.outcome := 'replayed';
    v_result.step_id := v_step.id;
    v_result.operation_id := v_operation.id;
    v_result.attempt_state := v_attempt.state;
    return v_result;
  end if;

  -- Otherwise the attempt must be running.
  if v_attempt.state <> 'running' then
    v_result.outcome := 'not_running';
    v_result.attempt_state := v_attempt.state;
    return v_result;
  end if;

  -- The step, if it is new, sets the stage; an operation, if there is an ordinal and it is new, is created planned.
  if v_step.id is null then
    insert into jobs.steps (account_id, attempt_id, step_key) values (p_account_id, p_attempt_id, p_step_key) returning * into v_step;
    update jobs.attempts a set stage = p_step_key where a.id = p_attempt_id;
  end if;
  if p_ordinal is not null and v_operation.id is null then
    insert into jobs.operations (account_id, step_id, ordinal, state) values (p_account_id, v_step.id, p_ordinal, 'planned') returning * into v_operation;
  end if;
  perform jobs.record_command(p_account_id, p_command_id, 'begin_step', v_digest, v_step.id);

  v_result.outcome := 'created';
  v_result.step_id := v_step.id;
  v_result.operation_id := v_operation.id;
  v_result.attempt_state := v_attempt.state;
  return v_result;
end;
$$;

comment on function api.begin_step(uuid, bigint, uuid, uuid, text, integer) is
  'Records a step of a running attempt (unique by attempt and step key) and, with an ordinal, its planned operation (unique by step and ordinal); sets the stage to the step key. Records that exist are returned and never recreated, whatever the attempt''s state. created | replayed | reused | denied | unavailable | not_running (carries the attempt''s state).';

-- The command: advance an operation --------------------------------------------------------------------------------------------------------

-- outcome: advanced | replayed | reused | denied | unavailable | not_running | invalid_transition. state is the operation's state (after the move, or as it is for
-- replayed, not_running and invalid_transition), request_id its provider request ID, attempt_state the attempt's state (for not_running, the state that refused).
create type api.operation_advance as (
  outcome text,
  operation_id uuid,
  state text,
  request_id text,
  attempt_state text
);

create function api.advance_operation(p_account_id uuid, p_epoch bigint, p_command_id uuid, p_operation_id uuid, p_to text, p_request_id text default null)
returns api.operation_advance
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_result api.operation_advance;
  v_job_id uuid;
  v_project_id uuid;
  v_digest text;
  v_command jobs.commands;
  v_operation jobs.operations;
  v_attempt_state text;
begin
  -- 1. The arguments.
  if p_account_id is null or p_epoch is null or p_epoch < 1 or p_command_id is null or p_operation_id is null
     or p_to is null or p_to not in ('planned', 'dispatched', 'completed', 'ambiguous', 'noncharge', 'settled', 'abandoned')
     or (p_request_id is not null and p_request_id !~ '^[!-~]{1,200}$') then
    raise exception 'invalid argument' using errcode = '22023';
  end if;

  -- 2. The authority.
  begin
    perform identity.assert_operation_authority(p_account_id, p_epoch);
  exception when sqlstate 'N3010' then
    v_result.outcome := 'denied';
    return v_result;
  end;

  -- 3. One command ID at a time for an Account.
  perform pg_advisory_xact_lock(hashtextextended('nova3d:jobs-command:' || p_account_id::text || ':' || p_command_id::text, 0));

  -- 4. The subject: an operation of the Account's, and its Project held FOR SHARE, live and without a tombstone.
  select a.job_id, j.project_id into v_job_id, v_project_id
    from jobs.operations o
    join jobs.steps s on s.id = o.step_id and s.account_id = o.account_id
    join jobs.attempts a on a.id = s.attempt_id and a.account_id = s.account_id
    join jobs.jobs j on j.id = a.job_id and j.account_id = a.account_id
   where o.id = p_operation_id and o.account_id = p_account_id;
  if not found or not jobs.hold_project(p_account_id, v_project_id) then
    v_result.outcome := 'unavailable';
    return v_result;
  end if;

  -- 5. One command at a time for a Job: a reconcile and a retry are never in flight together.
  perform pg_advisory_xact_lock(hashtextextended('nova3d:job:' || v_job_id::text, 0));

  -- 6. The receipt.
  v_digest := jobs.command_digest('advance_operation', array[p_operation_id::text, p_to, p_request_id]);
  select * into v_operation from jobs.operations o where o.id = p_operation_id for update;
  select a.state into v_attempt_state from jobs.steps s join jobs.attempts a on a.id = s.attempt_id where s.id = v_operation.step_id;
  v_result.operation_id := v_operation.id;
  select * into v_command from jobs.commands c where c.account_id = p_account_id and c.command_id = p_command_id;
  if v_command.command_id is not null then
    if v_command.digest <> v_digest or v_command.kind <> 'advance_operation' then
      v_result := null;
      v_result.outcome := 'reused';
      return v_result;
    end if;
    v_result.outcome := 'replayed';
    v_result.state := v_operation.state;
    v_result.request_id := v_operation.request_id;
    v_result.attempt_state := v_attempt_state;
    return v_result;
  end if;

  v_result.state := v_operation.state;
  v_result.request_id := v_operation.request_id;
  v_result.attempt_state := v_attempt_state;

  -- 7. The state it is already in, asked again with the same request ID (or none), is a replay, recorded under this command ID too.
  if v_operation.state = p_to then
    if p_request_id is null or p_request_id = v_operation.request_id then
      perform jobs.record_command(p_account_id, p_command_id, 'advance_operation', v_digest, v_operation.id);
      v_result.outcome := 'replayed';
    else
      v_result.outcome := 'invalid_transition';
    end if;
    return v_result;
  end if;

  -- A dispatch needs a running attempt, judged before the move itself: an operation of an attempt that is waiting, or has ended, is never sent. (An attempt that
  -- fails or is cancelled has abandoned its planned operations already, so it is the target, not the source, that this gate looks at.) Every other move works
  -- in any attempt state, so the late outcome of an attempt that has ended is still recorded.
  if p_to = 'dispatched' and v_attempt_state <> 'running' then
    v_result.outcome := 'not_running';
    return v_result;
  end if;

  -- A move that is not listed, a changed request ID, and a noncharge with no request ID to show for it.
  if (v_operation.state, p_to) not in (
       ('planned', 'dispatched'), ('planned', 'abandoned'), ('dispatched', 'completed'), ('dispatched', 'ambiguous'), ('dispatched', 'noncharge'),
       ('ambiguous', 'settled'), ('ambiguous', 'noncharge'))
     or (p_request_id is not null and v_operation.request_id is not null and p_request_id <> v_operation.request_id)
     or (p_to = 'noncharge' and coalesce(p_request_id, v_operation.request_id) is null) then
    v_result.outcome := 'invalid_transition';
    return v_result;
  end if;

  update jobs.operations o
     set state = p_to,
         request_id = coalesce(p_request_id, o.request_id),
         dispatched_at = case when p_to = 'dispatched' then clock_timestamp() else o.dispatched_at end,
         outcome_at = case when p_to in ('completed', 'ambiguous', 'noncharge') then coalesce(o.outcome_at, clock_timestamp()) else o.outcome_at end
   where o.id = p_operation_id
   returning * into v_operation;
  perform jobs.record_command(p_account_id, p_command_id, 'advance_operation', v_digest, v_operation.id);

  v_result.outcome := 'advanced';
  v_result.state := v_operation.state;
  v_result.request_id := v_operation.request_id;
  return v_result;
end;
$$;

comment on function api.advance_operation(uuid, bigint, uuid, uuid, text, text) is
  'Moves an operation along planned -> dispatched | abandoned, dispatched -> completed | ambiguous | noncharge, ambiguous -> settled | noncharge. A dispatch needs a running attempt; every other move works in any attempt state. noncharge needs a request ID; a stored request ID never changes. advanced | replayed | reused | denied | unavailable | not_running | invalid_transition (carries the state).';

-- The command: move an attempt -------------------------------------------------------------------------------------------------------------

-- outcome: moved | replayed | reused | denied | unavailable | blocked | open_operations | invalid_transition. state, stage and reason are the attempt's
-- (the derived reason for a waiting attempt: for blocked it is awaiting_reconciliation).
create type api.attempt_move as (
  outcome text,
  attempt_id uuid,
  attempt_number integer,
  state text,
  stage text,
  reason text
);

create function api.move_attempt(p_account_id uuid, p_epoch bigint, p_command_id uuid, p_attempt_id uuid, p_to text, p_reason text default null)
returns api.attempt_move
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_result api.attempt_move;
  v_job_id uuid;
  v_project_id uuid;
  v_digest text;
  v_command jobs.commands;
  v_attempt jobs.attempts;
begin
  -- 1. The arguments. A failed attempt has one of two reasons and a cancelled one has one of two; no other state has a reason.
  if p_account_id is null or p_epoch is null or p_epoch < 1 or p_command_id is null or p_attempt_id is null
     or p_to is null or p_to not in ('waiting', 'running', 'completed', 'failed', 'cancelled')
     or not coalesce(
       (p_to = 'failed' and p_reason in ('step_failed', 'lease_lost'))
       or (p_to = 'cancelled' and p_reason in ('user_cancelled', 'account_disabled'))
       or (p_to in ('waiting', 'running', 'completed') and p_reason is null),
       false) then
    raise exception 'invalid argument' using errcode = '22023';
  end if;

  -- 2. The authority.
  begin
    perform identity.assert_operation_authority(p_account_id, p_epoch);
  exception when sqlstate 'N3010' then
    v_result.outcome := 'denied';
    return v_result;
  end;

  -- 3. One command ID at a time for an Account.
  perform pg_advisory_xact_lock(hashtextextended('nova3d:jobs-command:' || p_account_id::text || ':' || p_command_id::text, 0));

  -- 4. The subject: an attempt of the Account's, and its Project held FOR SHARE, live and without a tombstone.
  select a.job_id, j.project_id into v_job_id, v_project_id
    from jobs.attempts a
    join jobs.jobs j on j.id = a.job_id and j.account_id = a.account_id
   where a.id = p_attempt_id and a.account_id = p_account_id;
  if not found or not jobs.hold_project(p_account_id, v_project_id) then
    v_result.outcome := 'unavailable';
    return v_result;
  end if;

  -- 5. One command at a time for a Job.
  perform pg_advisory_xact_lock(hashtextextended('nova3d:job:' || v_job_id::text, 0));

  -- 6. The receipt.
  v_digest := jobs.command_digest('move_attempt', array[p_attempt_id::text, p_to, p_reason]);
  select * into v_attempt from jobs.attempts a where a.id = p_attempt_id for update;
  select * into v_command from jobs.commands c where c.account_id = p_account_id and c.command_id = p_command_id;
  if v_command.command_id is not null then
    if v_command.digest <> v_digest or v_command.kind <> 'move_attempt' then
      v_result.outcome := 'reused';
      return v_result;
    end if;
    v_result.outcome := 'replayed';
    v_result.attempt_id := v_attempt.id;
    v_result.attempt_number := v_attempt.number;
    v_result.state := v_attempt.state;
    v_result.stage := v_attempt.stage;
    v_result.reason := jobs.derived_reason(v_attempt.job_id, v_attempt.number, v_attempt.state, v_attempt.reason);
    return v_result;
  end if;

  v_result.attempt_id := v_attempt.id;
  v_result.attempt_number := v_attempt.number;
  v_result.state := v_attempt.state;
  v_result.stage := v_attempt.stage;
  v_result.reason := jobs.derived_reason(v_attempt.job_id, v_attempt.number, v_attempt.state, v_attempt.reason);

  -- 7. The state it is already in, asked again with the same reason, is a replay, recorded under this command ID too.
  if v_attempt.state = p_to then
    if v_attempt.reason is not distinct from p_reason then
      perform jobs.record_command(p_account_id, p_command_id, 'move_attempt', v_digest, v_attempt.id);
      v_result.outcome := 'replayed';
    else
      v_result.outcome := 'invalid_transition';
    end if;
    return v_result;
  end if;

  -- A move that is not listed. A finished attempt has no move at all: it can never be started, extended or changed.
  if (v_attempt.state, p_to) not in (('waiting', 'running'), ('waiting', 'cancelled'), ('running', 'completed'), ('running', 'failed'), ('running', 'cancelled')) then
    v_result.outcome := 'invalid_transition';
    return v_result;
  end if;

  -- THE GATE: a retry does not start while an earlier attempt's operation is potentially chargeable.
  if p_to = 'running' and jobs.charge_open(v_attempt.job_id, v_attempt.number) then
    v_result.outcome := 'blocked';
    v_result.reason := 'awaiting_reconciliation';
    return v_result;
  end if;

  -- An attempt completes only with every operation settled one way or the other.
  if p_to = 'completed' and exists (
       select 1 from jobs.operations o join jobs.steps s on s.id = o.step_id
        where s.attempt_id = p_attempt_id and o.state in ('planned', 'dispatched', 'ambiguous')) then
    v_result.outcome := 'open_operations';
    return v_result;
  end if;

  -- Ending an attempt in failure or by cancellation abandons what never went out; what was dispatched stays potentially chargeable.
  if p_to in ('failed', 'cancelled') then
    update jobs.operations o
       set state = 'abandoned'
      from jobs.steps s
     where s.id = o.step_id and s.attempt_id = p_attempt_id and o.state = 'planned';
  end if;

  update jobs.attempts a
     set state = p_to,
         reason = p_reason,
         stage = case when p_to = 'running' then 'started' else a.stage end,
         started_at = case when p_to = 'running' then clock_timestamp() else a.started_at end,
         ended_at = case when p_to in ('completed', 'failed', 'cancelled') then clock_timestamp() else a.ended_at end
   where a.id = p_attempt_id
   returning * into v_attempt;
  perform jobs.record_command(p_account_id, p_command_id, 'move_attempt', v_digest, v_attempt.id);

  v_result.outcome := 'moved';
  v_result.state := v_attempt.state;
  v_result.stage := v_attempt.stage;
  v_result.reason := jobs.derived_reason(v_attempt.job_id, v_attempt.number, v_attempt.state, v_attempt.reason);
  return v_result;
end;
$$;

comment on function api.move_attempt(uuid, bigint, uuid, uuid, text, text) is
  'Moves an attempt: waiting -> running | cancelled, running -> completed | failed | cancelled. Starting is blocked (reason awaiting_reconciliation) while an operation of an earlier attempt is potentially chargeable; completing needs every operation settled (open_operations); failing or cancelling needs a reason from the closed set and abandons the planned operations. moved | replayed | reused | denied | unavailable | blocked | open_operations | invalid_transition.';

-- The command: request a retry -------------------------------------------------------------------------------------------------------------

-- outcome: created | replayed | reused | denied | unavailable | stale | not_retryable. The attempt fields are the new attempt's for created and replayed, and the
-- Job's HIGHEST attempt's for stale (its number) and not_retryable (its state).
create type api.retry_request as (
  outcome text,
  job_id uuid,
  attempt_id uuid,
  attempt_number integer,
  state text,
  stage text,
  reason text
);

create function api.request_retry(p_account_id uuid, p_epoch bigint, p_command_id uuid, p_job_id uuid, p_expected_number integer, p_input_digest text)
returns api.retry_request
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_result api.retry_request;
  v_project_id uuid;
  v_digest text;
  v_command jobs.commands;
  v_latest jobs.attempts;
  v_attempt jobs.attempts;
begin
  -- 1. The arguments.
  if p_account_id is null or p_epoch is null or p_epoch < 1 or p_command_id is null or p_job_id is null
     or p_expected_number is null or p_expected_number < 1
     or p_input_digest is null or p_input_digest !~ '^[0-9a-f]{64}$' then
    raise exception 'invalid argument' using errcode = '22023';
  end if;

  -- 2. The authority.
  begin
    perform identity.assert_operation_authority(p_account_id, p_epoch);
  exception when sqlstate 'N3010' then
    v_result.outcome := 'denied';
    return v_result;
  end;

  -- 3. One command ID at a time for an Account.
  perform pg_advisory_xact_lock(hashtextextended('nova3d:jobs-command:' || p_account_id::text || ':' || p_command_id::text, 0));

  -- 4. The subject: a Job of the Account's, and its Project held FOR SHARE, live and without a tombstone.
  select j.project_id into v_project_id from jobs.jobs j where j.id = p_job_id and j.account_id = p_account_id;
  if not found or not jobs.hold_project(p_account_id, v_project_id) then
    v_result.outcome := 'unavailable';
    return v_result;
  end if;

  -- 5. One command at a time for a Job: a retry and a reconcile are never in flight together.
  perform pg_advisory_xact_lock(hashtextextended('nova3d:job:' || p_job_id::text, 0));

  -- 6. The receipt.
  v_digest := jobs.command_digest('request_retry', array[p_job_id::text, p_expected_number::text, p_input_digest]);
  select * into v_command from jobs.commands c where c.account_id = p_account_id and c.command_id = p_command_id;
  if v_command.command_id is not null then
    if v_command.digest <> v_digest or v_command.kind <> 'request_retry' then
      v_result.outcome := 'reused';
      return v_result;
    end if;
    select * into v_attempt from jobs.attempts a where a.id = v_command.subject_id;
    v_result.outcome := 'replayed';
    v_result.job_id := v_attempt.job_id;
    v_result.attempt_id := v_attempt.id;
    v_result.attempt_number := v_attempt.number;
    v_result.state := v_attempt.state;
    v_result.stage := v_attempt.stage;
    v_result.reason := jobs.derived_reason(v_attempt.job_id, v_attempt.number, v_attempt.state, v_attempt.reason);
    return v_result;
  end if;

  -- 7. The person saw an older attempt than the highest; or the highest has not failed.
  select * into v_latest from jobs.attempts a where a.job_id = p_job_id order by a.number desc limit 1;
  v_result.job_id := p_job_id;
  v_result.attempt_id := v_latest.id;
  v_result.attempt_number := v_latest.number;
  v_result.state := v_latest.state;
  v_result.stage := v_latest.stage;
  v_result.reason := jobs.derived_reason(v_latest.job_id, v_latest.number, v_latest.state, v_latest.reason);
  if v_latest.number <> p_expected_number then
    v_result.outcome := 'stale';
    return v_result;
  end if;
  if v_latest.state <> 'failed' then
    v_result.outcome := 'not_retryable';
    return v_result;
  end if;

  -- The next attempt, linked to the failed one and waiting. It never waits inside this transaction and it is never started here: starting it is
  -- api.move_attempt, past the gate.
  insert into jobs.attempts (account_id, job_id, number, previous_attempt_id, input_digest, state, stage)
    values (p_account_id, p_job_id, v_latest.number + 1, v_latest.id, p_input_digest, 'waiting', 'retry')
    returning * into v_attempt;
  perform jobs.record_command(p_account_id, p_command_id, 'request_retry', v_digest, v_attempt.id);

  v_result.outcome := 'created';
  v_result.attempt_id := v_attempt.id;
  v_result.attempt_number := v_attempt.number;
  v_result.state := v_attempt.state;
  v_result.stage := v_attempt.stage;
  v_result.reason := jobs.derived_reason(v_attempt.job_id, v_attempt.number, v_attempt.state, v_attempt.reason);
  return v_result;
end;
$$;

comment on function api.request_retry(uuid, bigint, uuid, uuid, integer, text) is
  'Creates attempt number+1, linked to the Job''s highest attempt, waiting at stage retry, when that attempt is the expected number and has failed; the reason it returns is derived (awaiting_reconciliation while an earlier operation is potentially chargeable). It never waits and never starts the attempt. created | replayed | reused | denied | unavailable | stale (carries the highest number) | not_retryable (carries its state).';

-- The read ----------------------------------------------------------------------------------------------------------------------------------

-- found: the Job, its public state (its highest attempt's state, stage and reason), whether it can be retried (the highest attempt has failed) and every attempt in
-- order, each with its ID, number, state, stage, reason, times and the count of its potentially chargeable operations. Nothing else.
create type api.job_view as (
  outcome text,
  job_id uuid,
  project_id uuid,
  kind text,
  created_at timestamptz,
  state text,
  stage text,
  reason text,
  can_retry boolean,
  attempts jsonb
);

create function api.read_job(p_account_id uuid, p_epoch bigint, p_job_id uuid)
returns api.job_view
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_result api.job_view;
  v_job jobs.jobs;
begin
  if p_account_id is null or p_epoch is null or p_epoch < 1 or p_job_id is null then
    raise exception 'invalid argument' using errcode = '22023';
  end if;

  begin
    perform identity.assert_operation_authority(p_account_id, p_epoch);
  exception when sqlstate 'N3010' then
    v_result.outcome := 'denied';
    return v_result;
  end;

  -- A Job of the Account's, of a live Project without a tombstone: a foreign, deleted, unknown and tombstoned one are the same answer.
  select j.* into v_job
    from jobs.jobs j
    join projects.projects p on p.id = j.project_id and p.account_id = j.account_id
   where j.id = p_job_id and j.account_id = p_account_id and p.deleted_at is null and not lifecycle.is_tombstoned('project', p.id);
  if not found then
    v_result.outcome := 'unavailable';
    return v_result;
  end if;

  v_result.outcome := 'found';
  v_result.job_id := v_job.id;
  v_result.project_id := v_job.project_id;
  v_result.kind := v_job.kind;
  v_result.created_at := v_job.created_at;
  -- ONE statement reads the Job's public state and its attempts, so both come from one snapshot and cannot disagree: the state, stage and reason of the Job ARE
  -- those of its highest attempt in the list. (Separate statements of a volatile function each take a snapshot of their own, and a command that commits between
  -- them would show the Job in one state and its highest attempt in another.) The function is not declared stable instead, because PostgREST runs a stable function
  -- in a read-only transaction and the authority check above takes the Account's row FOR SHARE, which a read-only transaction refuses. The helpers it calls are
  -- stable, so they read the snapshot of this statement too. It writes nothing and takes no lock of its own.
  select s.state, s.stage, s.reason, s.state = 'failed', r.attempts
    into v_result.state, v_result.stage, v_result.reason, v_result.can_retry, v_result.attempts
    from (
      select coalesce(jsonb_agg(
               jsonb_build_object(
                 'id', a.id, 'number', a.number, 'state', a.state, 'stage', a.stage,
                 'reason', jobs.derived_reason(a.job_id, a.number, a.state, a.reason),
                 'created_at', a.created_at, 'started_at', a.started_at, 'ended_at', a.ended_at,
                 'chargeable_operations', (
                   select count(*) from jobs.operations o join jobs.steps t on t.id = o.step_id
                    where t.attempt_id = a.id and o.state in ('dispatched', 'ambiguous'))
               ) order by a.number),
             '[]'::jsonb) as attempts
        from jobs.attempts a
       where a.job_id = v_job.id
    ) r
    left join lateral jobs.public_state(v_job.id) s on true;
  return v_result;
end;
$$;

comment on function api.read_job(uuid, bigint, uuid) is
  'The Job of the Account, its public state (its highest attempt''s state, stage and reason), can_retry (the highest attempt has failed) and every attempt in order with its state, stage, reason, times and count of potentially chargeable operations. Nothing else. Read in one statement, so one snapshot. found | denied | unavailable (a foreign, deleted, unknown or tombstoned Job or Project).';

-- The preflight -----------------------------------------------------------------------------------------------------------------------------------

-- Everything api.preflight read before (20261022120000_usage_limits.sql), plus what this story depends on: the five tables of the closed jobs schema and the six
-- new `api` functions (forty-seven in all, each executable by the service role). It checks the catalog and executes none of them, reads at most one row of
-- each table and writes nothing. The bucket check stays last.
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
  perform x2.period_id, x2.settled_microdollars, x2.reserved_microdollars from usage.fixture_figures x2 limit 1;
  perform jb.id, jb.account_id, jb.project_id, jb.kind, jb.created_at from jobs.jobs jb limit 1;
  perform at.id, at.account_id, at.job_id, at.number, at.previous_attempt_id, at.input_digest, at.state, at.stage, at.reason, at.created_at, at.started_at, at.ended_at from jobs.attempts at limit 1;
  perform sp.id, sp.account_id, sp.attempt_id, sp.step_key, sp.created_at from jobs.steps sp limit 1;
  perform op.id, op.account_id, op.step_id, op.ordinal, op.state, op.request_id, op.created_at, op.dispatched_at, op.outcome_at from jobs.operations op limit 1;
  perform cm.account_id, cm.command_id, cm.kind, cm.digest, cm.subject_id, cm.created_at from jobs.commands cm limit 1;
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
      'api.read_job(uuid,bigint,uuid)'
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
  'Reads identity.session_grants (including its CSRF columns), identity.accounts (including its status handle), identity.account_preferences, identity.step_up_nonces, identity.fresh_authentications (including source), identity.recovery_tokens, projects.projects, projects.project_commands, projects.request_revisions (including the review columns), projects.request_images (including the labels and measurements and the retained pins), lifecycle.tombstones, lifecycle.ledger_outbox, lifecycle.ledger_relay, lifecycle.status_requests, lifecycle.job_receipts, the six artifacts tables and the artifacts.session_authority, artifacts.instance and artifacts.retained_pictures views, lifecycle.alarms, lifecycle.alarm_notices, lifecycle.heartbeats, usage.periods, usage.fixture_figures, jobs.jobs, jobs.attempts, jobs.steps, jobs.operations, jobs.commands, auth.sessions, auth.identities and auth.mfa_amr_claims (one row each at most), checks that the Story 1.5, 1.6, 1.7, 1.8, 1.9, 1.12, 1.13, 2.1, 2.2, 2.3, 2.12, 2.4 and 2.11 functions exist and are executable by the service role, that the private-files bucket exists and is private, and that the owner may delete from auth.sessions and auth.users, and answers ok. Read-only.';

-- Access ------------------------------------------------------------------------------------------------------------------------------------

revoke all on all tables in schema jobs from public, anon, authenticated, service_role;
revoke all on all sequences in schema jobs from public, anon, authenticated, service_role;
revoke all on all functions in schema jobs from public, anon, authenticated, service_role;

-- Closed by default; only the service role is let in, by name. (create or replace keeps the grants api.preflight already had.)
grant execute on function api.accept_job(uuid, bigint, uuid, uuid, text, text) to service_role;
grant execute on function api.begin_step(uuid, bigint, uuid, uuid, text, integer) to service_role;
grant execute on function api.advance_operation(uuid, bigint, uuid, uuid, text, text) to service_role;
grant execute on function api.move_attempt(uuid, bigint, uuid, uuid, text, text) to service_role;
grant execute on function api.request_retry(uuid, bigint, uuid, uuid, integer, text) to service_role;
grant execute on function api.read_job(uuid, bigint, uuid) to service_role;

-- New functions and types: have the Data API reload its schema cache now.
notify pgrst, 'reload schema';
