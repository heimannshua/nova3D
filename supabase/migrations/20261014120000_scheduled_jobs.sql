-- Story 1.9: periodic jobs. Immutable receipts and idempotent claims for the scheduled tasks, the dormant-identity purge, and a
-- registration that can find its identity gone.
--
-- A QStash schedule calls POST /api/jobs (lib/jobs.ts) with a signature the application verifies. This file is the database half of
-- what that call does once it is authentic and for this environment:
--
--   lifecycle.job_receipts       one row per ATTEMPT of one message of one schedule: task, schedule ID, message ID, attempt, start,
--                                finish, outcome (`ran`, `idle`, `no_store`, `failed`) and a small `json` result of counts and class
--                                names only (never an address, an ID, a key or a message: lifecycle.job_result_ok enforces the
--                                shape). Unique per (schedule ID, message ID, attempt). Immutable apart from being finished, once;
--                                no delete, no truncate. QStash documents no scheduled-time header, so the idempotency key is the
--                                (schedule ID, message ID) pair: a retry of a delivery reuses the message ID. Two messages for one
--                                slot are covered by each task being idempotent.
--   api.claim_job_run            claims a run BEFORE the task starts, serialized per (schedule ID, message ID) by an advisory lock:
--                                  claimed    a new attempt (the first, or attempt + 1 after a `failed` one or after an unfinished
--                                             one went past its lease: 300 seconds by default)
--                                  duplicate  the latest attempt finished with anything but `failed`: nothing runs
--                                  running    the latest attempt is unfinished and younger than the lease
--   api.finish_job_run           finishes a receipt, once: finished | already_finished | not_found
--   api.last_job_run             the newest FINISHED receipt of a task (all null when there is none): what the alarm of Story 1.13
--                                reads
--   api.purge_dormant_identities deletes Auth identities that never became Accounts, under the lock registration takes first (see
--                                the function)
--   api.register_with_code       re-created with ONE change: a registration that finds its Auth identity gone answers the new
--                                outcome `no_identity`, which is not a counted failure (the register page asks the person to sign
--                                in again)
--   api.preflight                re-created carrying every earlier probe and the new table, functions and the privilege to delete
--                                from auth.users
--
-- Like the Story 1.8 tables, the receipts table is closed explicitly (row-level security on, no policy, every privilege revoked from
-- public, anon, authenticated and service_role), because the `lifecycle` schema is one the Data API lists. It is reached only through
-- `api` functions, which run as the owner with an empty search_path and are executable by the service role alone.

-- Receipts ------------------------------------------------------------------------------------------------------------------------

-- What a receipt's result may hold: an object of at most 1 KB whose keys are lower-case words and whose values are small whole
-- numbers, booleans, or a single word (a class name such as `TypeError`, or an outcome such as `store_unavailable`). Nothing else fits:
-- not an address, not a UUID, not a key, not a message.
create function lifecycle.job_result_ok(p_result json) returns boolean
language sql
immutable
set search_path = ''
as $$
  select p_result is not null
     and json_typeof(p_result) = 'object'
     and octet_length(p_result::text) <= 1024
     and not exists (
       select 1
         from json_each(p_result) e
        where e.key !~ '^[a-z][a-z0-9_]{0,31}$'
           or not (
             (json_typeof(e.value) = 'number' and e.value::text ~ '^(0|[1-9][0-9]{0,11})$')
             or json_typeof(e.value) = 'boolean'
             or (json_typeof(e.value) = 'string' and (e.value #>> '{}') ~ '^(?:[A-Z][A-Za-z]{0,47}|[a-z][a-z_]{0,31})$')
           )
     )
$$;

comment on function lifecycle.job_result_ok(json) is
  'Whether a job receipt''s result is only counts, booleans and single words (class names, outcomes). Callable by no API role.';

create table lifecycle.job_receipts (
  id uuid primary key default gen_random_uuid(),
  task text not null check (task ~ '^[a-z][a-z0-9-]{0,62}$'),
  -- QStash's own IDs for the schedule and for the message it delivers (a retry of a delivery keeps the message ID).
  schedule_id text not null check (schedule_id ~ '^[A-Za-z0-9_.:-]{1,128}$'),
  message_id text not null check (message_id ~ '^[A-Za-z0-9_.:-]{1,128}$'),
  attempt integer not null check (attempt >= 1),
  started_at timestamptz not null default clock_timestamp(),
  finished_at timestamptz,
  outcome text check (outcome in ('ran', 'idle', 'no_store', 'failed')),
  result json,
  constraint job_receipts_run_key unique (schedule_id, message_id, attempt),
  check ((finished_at is null) = (outcome is null) and (finished_at is null) = (result is null)),
  check (result is null or lifecycle.job_result_ok(result))
);

comment on table lifecycle.job_receipts is
  'One immutable receipt per attempt of a scheduled message: task, schedule ID, message ID, attempt, start, finish, outcome and a result of counts and class names only. Finished once; never deleted or truncated. Written only by api.claim_job_run and api.finish_job_run.';

-- What the alarm of Story 1.13 asks: the newest finished receipt of a task.
create index job_receipts_task_finished on lifecycle.job_receipts (task, finished_at desc) where finished_at is not null;

create function lifecycle.guard_job_receipt() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.id <> old.id or new.task <> old.task or new.schedule_id <> old.schedule_id or new.message_id <> old.message_id
     or new.attempt <> old.attempt or new.started_at <> old.started_at then
    raise exception 'a job receipt is immutable' using errcode = '55000';
  end if;
  if old.finished_at is not null or new.finished_at is null then
    raise exception 'a job receipt is finished once' using errcode = '55000';
  end if;
  return new;
end;
$$;

create trigger job_receipts_guard before update on lifecycle.job_receipts
  for each row execute function lifecycle.guard_job_receipt();
create trigger job_receipts_no_delete before delete on lifecycle.job_receipts
  for each row execute function lifecycle.refuse_change();
create trigger job_receipts_no_truncate before truncate on lifecycle.job_receipts
  for each statement execute function lifecycle.refuse_change();

-- Closed by default, like every table of this schema.
alter table lifecycle.job_receipts enable row level security;
-- No policy: only the owner and roles that bypass RLS can read a row, and the privileges below leave anon, authenticated and
-- service_role no path to the table at all.
revoke all on lifecycle.job_receipts from public, anon, authenticated, service_role;
revoke all on all functions in schema lifecycle from public, anon, authenticated, service_role;

-- The claim -----------------------------------------------------------------------------------------------------------------------

create type api.job_claim as (outcome text, receipt_id uuid, attempt integer);

-- Claims a run of one scheduled message, before its task starts, so that "only one run executes" holds without a long transaction. A
-- crash leaves an unfinished receipt, and the lease (p_lease_seconds, 300 by default) lets the next delivery replace it.
-- Serialized per (schedule ID, message ID) by a transaction-level advisory lock, so two deliveries of one message queue here and the
-- second reads what the first committed.
--   claimed    the latest attempt does not exist, finished `failed`, or is unfinished and past its lease: a NEW attempt row is written
--              (attempt 1, or the latest plus one) and its receipt ID returned
--   duplicate  the latest attempt finished with anything but `failed`
--   running    the latest attempt is unfinished and younger than the lease
-- `receipt_id` and `attempt` are those of the new attempt, or of the latest one for `duplicate` and `running`.
create function api.claim_job_run(p_task text, p_schedule_id text, p_message_id text, p_lease_seconds integer default 300)
returns api.job_claim
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_result api.job_claim;
  v_latest lifecycle.job_receipts;
begin
  if p_task is null or p_task !~ '^[a-z][a-z0-9-]{0,62}$'
     or p_schedule_id is null or p_schedule_id !~ '^[A-Za-z0-9_.:-]{1,128}$'
     or p_message_id is null or p_message_id !~ '^[A-Za-z0-9_.:-]{1,128}$'
     or p_lease_seconds is null or p_lease_seconds not between 1 and 3600 then
    raise exception 'invalid argument' using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('nova3d:job-run:' || p_schedule_id || ':' || p_message_id, 0));

  -- Read after the lock is held: a claim that committed while this waited is seen.
  select * into v_latest
    from lifecycle.job_receipts r
   where r.schedule_id = p_schedule_id and r.message_id = p_message_id
   order by r.attempt desc
   limit 1;
  if found then
    -- A message is one task's. A call that names another task for it is not a retry of anything.
    if v_latest.task <> p_task then
      raise exception 'invalid argument' using errcode = '22023';
    end if;
    v_result.receipt_id := v_latest.id;
    v_result.attempt := v_latest.attempt;
    if v_latest.finished_at is not null and v_latest.outcome <> 'failed' then
      v_result.outcome := 'duplicate';
      return v_result;
    end if;
    if v_latest.finished_at is null and v_latest.started_at + make_interval(secs => p_lease_seconds) > clock_timestamp() then
      v_result.outcome := 'running';
      return v_result;
    end if;
  end if;

  insert into lifecycle.job_receipts (task, schedule_id, message_id, attempt)
    values (p_task, p_schedule_id, p_message_id, coalesce(v_latest.attempt, 0) + 1)
    returning id, attempt into v_result.receipt_id, v_result.attempt;
  v_result.outcome := 'claimed';
  return v_result;
end;
$$;

comment on function api.claim_job_run(text, text, text, integer) is
  'Claims one run of a scheduled message, serialized per (schedule ID, message ID): claimed (a new attempt) | duplicate (the latest finished with anything but failed) | running (unfinished and inside the lease, 300 seconds by default). A failed attempt, or an unfinished one past its lease, is replaced by attempt + 1.';

-- The finish ----------------------------------------------------------------------------------------------------------------------

create type api.job_finish as (outcome text);

-- Finishes a receipt, once, with the outcome and a result of counts and class names. A second finish changes nothing.
--   finished | already_finished | not_found
create function api.finish_job_run(p_receipt_id uuid, p_outcome text, p_result json)
returns api.job_finish
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_result api.job_finish;
begin
  if p_receipt_id is null or p_outcome is null or p_outcome not in ('ran', 'idle', 'no_store', 'failed') or not lifecycle.job_result_ok(p_result) then
    raise exception 'invalid argument' using errcode = '22023';
  end if;

  update lifecycle.job_receipts r
     set finished_at = clock_timestamp(), outcome = p_outcome, result = p_result
   where r.id = p_receipt_id and r.finished_at is null;
  if found then
    v_result.outcome := 'finished';
  elsif exists (select 1 from lifecycle.job_receipts r where r.id = p_receipt_id) then
    v_result.outcome := 'already_finished';
  else
    v_result.outcome := 'not_found';
  end if;
  return v_result;
end;
$$;

comment on function api.finish_job_run(uuid, text, json) is
  'Finishes a job receipt once, with its outcome (ran, idle, no_store, failed) and a result of counts and class names only. finished | already_finished | not_found.';

-- The newest finished receipt of a task ---------------------------------------------------------------------------------------------

create type api.job_last as (outcome text, attempt integer, started_at timestamptz, finished_at timestamptz, result json);

-- All fields null when the task has never finished a run. Read-only: what the alarm of Story 1.13 reads.
create function api.last_job_run(p_task text)
returns api.job_last
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_result api.job_last;
begin
  if p_task is null or p_task !~ '^[a-z][a-z0-9-]{0,62}$' then
    raise exception 'invalid argument' using errcode = '22023';
  end if;
  select r.outcome, r.attempt, r.started_at, r.finished_at, r.result
    into v_result.outcome, v_result.attempt, v_result.started_at, v_result.finished_at, v_result.result
    from lifecycle.job_receipts r
   where r.task = p_task and r.finished_at is not null
   order by r.finished_at desc, r.id
   limit 1;
  return v_result;
end;
$$;

comment on function api.last_job_run(text) is
  'The newest finished receipt of a task (outcome, attempt, start, finish, result), all null when it has never finished a run. Read-only.';

-- The dormant-identity purge --------------------------------------------------------------------------------------------------------

create type api.purge_report as (deleted integer, kept integer, locked integer, remaining integer);

-- Deletes Auth identities that never became Accounts and have been idle for 30 days. An identity is dormant when it has no
-- `identity.accounts` row and BOTH coalesce(last_sign_in_at, created_at) and its registration attempt (when it has one) are older than
-- 30 days. (An Account's invitation, pre-authorization and Workspace all hang off the Account, so no Account means no claim.)
--
-- The order is the whole point, because registration (api.register_with_code, api.consume_preauthorization) takes the lock on the
-- identity's row FIRST and writes its attempt time under it. For each candidate, in its own sub-block, so one refusal undoes nothing
-- else (the batch is one transaction):
--   1. `select ... from auth.users where id = $1 for update skip locked`: the lock registration takes. A row that is locked is a
--      registration (or another purge) in flight: it is counted `locked` and left alone. This is also what makes the outcome single:
--      the purge deletes first and the waiting registration finds no identity (`no_identity`), or the registration holds the lock and
--      the purge deletes nothing;
--   2. the conditions are RE-READ in a separate statement, with the lock held. A single `delete ... where not exists (...)` would
--      decide on the snapshot taken before the lock was won and so could delete an identity that registered in between (the note of
--      Story 1.3); a statement that starts after the lock sees every registration that committed before it;
--   3. the identity is deleted. The foreign key from identity.accounts.user_id is RESTRICT, so an Account that somehow appeared can
--      never be orphaned: that refusal is counted `kept`.
-- The oldest candidates go first, at most p_limit (default 100, 1 to 500; there is no age parameter: 30 days is not a setting).
-- It answers counts only: how many were deleted, kept (no longer dormant after the lock, already gone, or refused by a foreign key),
-- locked (skipped), and how many dormant identities remain (at most 10,001) once it is done.
create function api.purge_dormant_identities(p_limit integer default 100)
returns api.purge_report
language plpgsql
security definer
set search_path = ''
as $$
declare
  c_age constant interval := interval '30 days';
  v_report api.purge_report;
  v_candidate uuid;
  v_locked uuid;
  v_deleted integer;
begin
  if p_limit is null or p_limit not between 1 and 500 then
    raise exception 'invalid argument' using errcode = '22023';
  end if;
  v_report.deleted := 0;
  v_report.kept := 0;
  v_report.locked := 0;

  for v_candidate in
    select u.id
      from auth.users u
     where not exists (select 1 from identity.accounts a where a.user_id = u.id)
       and coalesce(u.last_sign_in_at, u.created_at) < clock_timestamp() - c_age
       and not exists (select 1 from identity.registration_attempts t where t.user_id = u.id and t.last_attempt_at >= clock_timestamp() - c_age)
     order by coalesce(u.last_sign_in_at, u.created_at), u.id
     limit p_limit
  loop
    begin
      select u.id into v_locked from auth.users u where u.id = v_candidate for update skip locked;
      if not found then
        if exists (select 1 from auth.users u where u.id = v_candidate) then
          v_report.locked := v_report.locked + 1;
        else
          v_report.kept := v_report.kept + 1;
        end if;
        continue;
      end if;

      -- A separate statement: it starts after the lock is held, so it sees every registration that committed before.
      perform 1
        from auth.users u
       where u.id = v_candidate
         and not exists (select 1 from identity.accounts a where a.user_id = u.id)
         and coalesce(u.last_sign_in_at, u.created_at) < clock_timestamp() - c_age
         and not exists (select 1 from identity.registration_attempts t where t.user_id = u.id and t.last_attempt_at >= clock_timestamp() - c_age);
      if not found then
        v_report.kept := v_report.kept + 1;
        continue;
      end if;

      delete from auth.users u where u.id = v_candidate;
      get diagnostics v_deleted = row_count;
      v_report.deleted := v_report.deleted + v_deleted;
      v_report.kept := v_report.kept + (1 - v_deleted);
    exception when foreign_key_violation then
      -- An Account appeared (the RESTRICT key refused the delete): the identity is kept, and the other candidates are unaffected.
      v_report.kept := v_report.kept + 1;
    end;
  end loop;

  select count(*)::integer into v_report.remaining
    from (
      select 1
        from auth.users u
       where not exists (select 1 from identity.accounts a where a.user_id = u.id)
         and coalesce(u.last_sign_in_at, u.created_at) < clock_timestamp() - c_age
         and not exists (select 1 from identity.registration_attempts t where t.user_id = u.id and t.last_attempt_at >= clock_timestamp() - c_age)
       limit 10001
    ) d;
  return v_report;
end;
$$;

comment on function api.purge_dormant_identities(integer) is
  'Deletes Auth identities with no Account that have been idle for 30 days (no sign-in, no registration attempt), each under the row lock registration takes first, re-reading the conditions after the lock. Returns counts only: deleted, kept, locked, remaining. A foreign-key refusal counts as kept.';

-- Registration finds its identity gone ----------------------------------------------------------------------------------------------

-- As 20261010120100_api.sql defined it, with ONE change: step 1 remembers whether the Auth identity's row was found, and a
-- registration that finds it gone (the purge deleted it while this waited for the lock, or it never existed) answers `no_identity`
-- instead of a counted `refused`: the identity is not a guess at a code, and the person is asked to sign in again. Nothing else
-- differs, so every earlier answer, limit and audit is as it was.
create or replace function api.register_with_code(p_user_id uuid, p_command_id uuid, p_code_hash text, p_origin_hash text)
returns api.registration_receipt
language plpgsql
security definer
set search_path = ''
as $$
declare
  c_origin_limit constant integer := 5;
  c_global_limit constant integer := 100;
  v_epoch bigint := floor(extract(epoch from clock_timestamp()))::bigint;
  v_origin_window bigint := v_epoch / 900;
  v_global_window bigint := v_epoch / 3600;
  v_origin_failures integer;
  v_global_failures integer;
  v_receipt api.registration_receipt;
  v_command identity.registration_commands;
  v_account identity.accounts;
  v_known boolean := false;
  v_reused boolean := false;
  v_identity_found boolean := false;
  v_subject text;
  v_invitation_id uuid;
  v_account_id uuid;
  v_constraint text;
  v_ok boolean := false;
begin
  if p_user_id is null or p_command_id is null
     or p_code_hash is null or p_code_hash !~ '^[0-9a-f]{64}$'
     or p_origin_hash is null or p_origin_hash !~ '^[0-9a-f]{64}$' then
    raise exception 'invalid argument' using errcode = '22023';
  end if;

  v_receipt.command_id := p_command_id;
  v_receipt.replayed := false;

  -- 1. The identity lock and the persisted attempt time.
  perform 1 from auth.users u where u.id = p_user_id for update;
  v_identity_found := found;
  if v_identity_found then
    insert into identity.registration_attempts (user_id, last_attempt_at)
      values (p_user_id, clock_timestamp())
      on conflict (user_id) do update set last_attempt_at = excluded.last_attempt_at;
  end if;

  -- 2. What this user already has. The same command and code, or no command at all but an Account,
  --    is answered with the Account; the command ID of someone else's registration, or this user's
  --    own with another code, is a changed payload and falls through to the limiter.
  select * into v_command from identity.registration_commands rc where rc.command_id = p_command_id;
  if found then
    select * into v_account from identity.accounts a where a.id = v_command.account_id;
    if v_account.user_id = p_user_id and v_command.code_hash = p_code_hash then
      v_known := true;
    else
      v_reused := true;
    end if;
  else
    select * into v_account from identity.accounts a where a.user_id = p_user_id;
    v_known := found;
  end if;
  if v_known then
    v_receipt.outcome := case when v_account.status = 'active' then 'registered' else 'disabled' end;
    v_receipt.account_id := v_account.id;
    v_receipt.role := v_account.role;
    v_receipt.replayed := true;
    select w.id into v_receipt.workspace_id from projects.workspaces w where w.account_id = v_account.id;
    return v_receipt;
  end if;

  -- 3. The limiter. The no-op update takes each counter row's lock and reads it, so parallel
  --    attempts from one origin queue here and each sees the failures of those before it. Rows
  --    are locked in a fixed order (origin, then global).
  insert into identity.rate_limit_counters as c (scope, key_hash, window_id, failures, expires_at)
    values ('origin', p_origin_hash, v_origin_window, 0, to_timestamp((v_origin_window + 1) * 900 + 3600))
    on conflict (scope, key_hash, window_id) do update set expires_at = excluded.expires_at
    returning c.failures into v_origin_failures;
  insert into identity.rate_limit_counters as c (scope, key_hash, window_id, failures, expires_at)
    values ('global', 'global', v_global_window, 0, to_timestamp((v_global_window + 1) * 3600 + 3600))
    on conflict (scope, key_hash, window_id) do update set expires_at = excluded.expires_at
    returning c.failures into v_global_failures;
  -- Expired windows are dropped a few at a time, never waiting on a locked row.
  delete from identity.rate_limit_counters d
   where d.ctid in (
     select s.ctid from identity.rate_limit_counters s
      where s.expires_at < clock_timestamp()
      order by s.expires_at
      limit 50
      for update skip locked
   );

  if v_origin_failures >= c_origin_limit or v_global_failures >= c_global_limit then
    v_receipt.outcome := 'limited';
    return v_receipt;
  end if;

  -- 4. A command ID reused with another code (or by another user) is refused and counted.
  if v_reused then
    perform identity.count_registration_failure(p_origin_hash, v_origin_window, v_global_window);
    v_receipt.outcome := 'refused';
    return v_receipt;
  end if;

  -- Only a verified Google identity can register.
  select g.google_subject into v_subject from identity.verified_google(p_user_id) g;
  if v_subject is null then
    -- The Auth identity is gone (Story 1.9: the dormant-identity purge deleted it while this waited for the lock): nothing was
    -- guessed, so nothing is counted, and the person is asked to sign in again.
    if not v_identity_found then
      v_receipt.outcome := 'no_identity';
      return v_receipt;
    end if;
    perform identity.count_registration_failure(p_origin_hash, v_origin_window, v_global_window);
    v_receipt.outcome := 'refused';
    return v_receipt;
  end if;

  -- 5. Claim the code and create everything, or nothing.
  begin
    select i.id into v_invitation_id
      from identity.invitations i
     where i.code_hash = p_code_hash and i.status = 'unused'
       for update;
    if found then
      v_account_id := identity.activate_account(p_user_id, v_subject, 'member', 'invitation');
      update identity.invitations i
         set status = 'redeemed', redeemed_at = clock_timestamp(), redeemed_account_id = v_account_id
       where i.id = v_invitation_id;
      insert into identity.registration_commands (command_id, account_id, code_hash)
        values (p_command_id, v_account_id, p_code_hash);
      perform identity.record_audit('account:' || v_account_id::text, 'account.activated', 'invitation:' || v_invitation_id::text);
      v_ok := true;
    end if;
  exception
    -- Specific conditions only. (A name that ends in 000, such as object_not_in_prerequisite_state, would
    -- match its whole class, lock_not_available included.)
    when unique_violation or foreign_key_violation or check_violation or not_null_violation or raise_exception then
      get stacked diagnostics v_constraint = constraint_name;
      raise warning 'api.register_with_code rolled back (sqlstate %, constraint %)', sqlstate, coalesce(v_constraint, '-');
      v_ok := false;
  end;

  if not v_ok then
    perform identity.count_registration_failure(p_origin_hash, v_origin_window, v_global_window);
    v_receipt.outcome := 'refused';
    return v_receipt;
  end if;

  v_receipt.outcome := 'registered';
  v_receipt.account_id := v_account_id;
  v_receipt.role := 'member';
  select w.id into v_receipt.workspace_id from projects.workspaces w where w.account_id = v_account_id;
  return v_receipt;
end;
$$;

comment on function api.register_with_code(uuid, uuid, text, text) is
  'Redeems an invitation code (by hash) for an Auth user: Account and Workspace in one transaction, idempotent per command UUID, limited per origin and globally. An Auth identity that is gone answers no_identity (not a counted failure).';

-- The preflight -------------------------------------------------------------------------------------------------------------------------

-- Everything api.preflight read before (20261013120000_tombstones_and_ledger.sql), plus what this story depends on: the receipts table
-- (with the columns the functions use), the four functions of this story (and lifecycle.job_result_ok) exist, and the service role
-- can execute the four `api` ones (twenty-two `api` functions in all). The owner must be allowed to delete from auth.users, which the
-- purge does in the owner's name, as it must for auth.sessions (a disable). It checks the catalog and executes none of them, reads at
-- most one row of each table and writes nothing.
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
  perform s.kind, s.target_id, s.status_handle, s.revision, s.recorded_at from lifecycle.tombstones s limit 1;
  perform o.seq, o.id, o.event, o.created_at, o.relayed_at from lifecycle.ledger_outbox o limit 1;
  perform r.id, r.holder, r.lease_expires_at from lifecycle.ledger_relay r limit 1;
  perform q.scope, q.key_hash, q.window_id, q.requests, q.expires_at from lifecycle.status_requests q limit 1;
  perform b.id, b.task, b.schedule_id, b.message_id, b.attempt, b.started_at, b.finished_at, b.outcome, b.result from lifecycle.job_receipts b limit 1;
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
      'api.purge_dormant_identities(integer)'
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

  v_result.ok := true;
  return v_result;
end;
$$;

comment on function api.preflight() is
  'Reads identity.session_grants (including its CSRF columns), identity.accounts (including its status handle), identity.account_preferences, identity.step_up_nonces, identity.fresh_authentications (including source), identity.recovery_tokens, projects.projects, projects.project_commands, lifecycle.tombstones, lifecycle.ledger_outbox, lifecycle.ledger_relay, lifecycle.status_requests, lifecycle.job_receipts, auth.sessions, auth.identities and auth.mfa_amr_claims (one row each at most), checks that the Story 1.5, 1.6, 1.7, 1.8 and 1.9 functions exist and are executable by the service role and that the owner may delete from auth.sessions and auth.users, and answers ok. Read-only.';

-- Access --------------------------------------------------------------------------------------------------------------------------------

-- Closed by default; only the service role is let in, by name. lifecycle.* helpers are granted to nobody: SQL that runs as the owner
-- calls them. (create or replace keeps the grants api.register_with_code and api.preflight had.)
grant execute on function api.claim_job_run(text, text, text, integer) to service_role;
grant execute on function api.finish_job_run(uuid, text, json) to service_role;
grant execute on function api.last_job_run(text) to service_role;
grant execute on function api.purge_dormant_identities(integer) to service_role;

-- New functions and types: have the Data API reload its schema cache now.
notify pgrst, 'reload schema';
