-- Story 2.7: accept and execute durable fenced Jobs.
--
-- Story 2.11 recorded the identities of background work and Story 2.6 reserves a cost against an operation. Nothing accepted work durably, dispatched it, ran a step, decided who
-- may publish its result, or ended it when the user cancels or the Account is disabled. This migration adds exactly that, additively, on the closed `jobs` schema:
--
--   jobs.outbox            one row for EVERY attempt, written by a trigger on jobs.attempts in the same transaction as the attempt: the Account's epoch, the Project's revision, the worker
--                          version and the plan the attempt is pinned to, and the state of its publication. An attempt can never exist without its row. Only the publisher's lease
--                          (publish_until) and the one-time published_at and message_id change.
--   jobs.workers           the registry of compatible workers (global: no Account). Registering a version retires the earlier versions of the same (issuer, worker kind).
--   jobs.leases            at most one for an attempt: the 120-second lease, the fencing token, how it ended and why. It is extended while live and ended once.
--   jobs.callbacks         the `jti` of every signed worker command that was accepted: a replayed token is refused.
--   jobs.* constants       the recorded numbers (lease 120 s, renewal 30 s, publish grace 15 s, publish lease 60 s, 3 open Jobs, alarms at 120 s and 300 s, the built-in step version 1 and its
--                          one kind, test_workload). lib/job-dispatch.ts mirrors them and a test holds the two equal.
--   api.submit_job         commits a Job, its planned operations and their reservations and the outbox together, or nothing (`refused`, `at_capacity`).
--   api.cancel_job         ends the lease FIRST, then moves the attempt to cancelled/user_cancelled, abandons its planned operations and releases what never went out.
--   api.list_jobs, api.read_job_detail   the Account's Jobs and one Job in full, with `awaiting_worker` among the reasons (api.read_job and jobs.derived_reason are unchanged).
--   api.register_worker, api.claim_attempt, api.renew_lease, api.run_step, api.finish_operation, api.finish_attempt   the fenced commands of a worker (and of the built-in step).
--   api.record_callback    the replay and revoked-key check of a signed worker command (as api.record_heartbeat).
--   api.claim_outbox, api.mark_published   the publisher's two calls: lease the unpublished rows, then record the message ID once.
--   api.sweep_attempts     expires leases (failed/lease_lost), cancels the attempts of a disabled or re-epoched Account, releases what never went out.
--   api.cancel_account_jobs  the authority-free cancellation of an Account's open attempts when it is disabled; one audit event `jobs.cancelled`.
--   api.alarm_observations also reports the age of the oldest unpublished outbox row and of the oldest live lease that has expired.
--   api.preflight          re-created from 20261030120000 keeping every statement, with the Story 2.7 block (sixty-nine `api` functions in all).
--
-- Stored attempt states, moves and reasons are UNCHANGED: stale or revoked work ends as failed/step_failed or cancelled, and the cause is the lease `detail`. Nothing retries by itself;
-- the only way to a new attempt is api.request_retry, which now also yields an outbox row through the trigger.
--
-- The commands that act for a user (submit_job, cancel_job, list_jobs, read_job_detail) take the Account, its epoch and a command ID (the reads take no command ID) and run: the arguments
-- (22023); identity.assert_operation_authority (N3010 answers `denied`); the advisory lock `nova3d:jobs-command:<account>:<command>`; the subject belongs to the Account and its Project is held
-- (`unavailable`: ONE answer for a foreign, a deleted, an unknown and a tombstoned subject); the advisory lock `nova3d:job:<job>`; the receipt by (Account, command ID); then the command's checks.
-- The commands of a worker take no Account and no epoch from the caller: each reads the epoch bound in the outbox row and asks identity.assert_operation_authority with it. Every fenced command
-- checks, in this order: the lease by fence belongs to the attempt (`fence_mismatch`), is not ended (`cancelled`, `expired`, `revoked`), has an expiry in the future (`expired`), the attempt is
-- running (`not_running`), the authority holds with the bound epoch (otherwise the lease is ended and the attempt cancelled before `revoked` is answered), the Project is held (`unavailable`).
--
-- Lock order, everywhere: the Account row (FOR SHARE), the command lock, the Project row (FOR SHARE), the capacity lock, the Job lock, then the Usage locks. The two commands that walk many Jobs
-- (api.sweep_attempts and api.cancel_account_jobs) take the global lock `nova3d:jobs-sweep` first, so two of them never run together, and release money only after every Job lock is taken.
--
-- Stable error codes: 22023 (arguments), 55000 (a guarded row refuses a change), 23514 (a row is not shaped as the family requires), N3050 (internal: a submission is refused and rolled back).
--
-- Same pattern as the earlier migrations: the functions in `api` run as the table owner with an empty search_path, are closed by default (the default-privileges rules of
-- 20261010120000_accounts.sql) and granted to service_role by name at the end; the functions in `jobs` are callable by no API role at all.

-- The recorded constants ------------------------------------------------------------------------------------------------------------------

-- Changeable only by a recorded decision. lib/job-dispatch.ts mirrors every one, and a test holds the two equal.
create function jobs.lease_seconds() returns integer language sql immutable set search_path = '' as $$ select 120 $$;
create function jobs.renewal_seconds() returns integer language sql immutable set search_path = '' as $$ select 30 $$;
create function jobs.publish_grace_seconds() returns integer language sql immutable set search_path = '' as $$ select 15 $$;
create function jobs.publish_lease_seconds() returns integer language sql immutable set search_path = '' as $$ select 60 $$;
create function jobs.open_job_limit() returns integer language sql immutable set search_path = '' as $$ select 3 $$;
create function jobs.outbox_alarm_seconds() returns integer language sql immutable set search_path = '' as $$ select 120 $$;
create function jobs.lease_alarm_seconds() returns integer language sql immutable set search_path = '' as $$ select 300 $$;
create function jobs.builtin_version() returns integer language sql immutable set search_path = '' as $$ select 1 $$;
create function jobs.builtin_kind() returns text language sql immutable set search_path = '' as $$ select 'test_workload'::text $$;

comment on function jobs.lease_seconds() is 'How long a lease lasts from its claim or its latest renewal: 120 seconds. A recorded constant. Callable by no API role.';
comment on function jobs.renewal_seconds() is 'How often a worker renews its lease: every 30 seconds (the worker''s duty; nothing here enforces it). A recorded constant. Callable by no API role.';
comment on function jobs.publish_grace_seconds() is 'How old an unpublished outbox row is before the sweep publishes it: 15 seconds. A recorded constant. Callable by no API role.';
comment on function jobs.publish_lease_seconds() is 'How long a publisher holds an outbox row it claimed: 60 seconds. A recorded constant. Callable by no API role.';
comment on function jobs.open_job_limit() is 'How many Jobs with a waiting or running attempt an Account may have: 3. A recorded constant. Callable by no API role.';
comment on function jobs.outbox_alarm_seconds() is 'The age of an unpublished outbox row above which the outbox-age alarm is raised: 120 seconds. A recorded constant. Callable by no API role.';
comment on function jobs.lease_alarm_seconds() is 'How long a live lease has been expired before the lease-expired-unclaimed alarm is raised: 300 seconds. A recorded constant. Callable by no API role.';
comment on function jobs.builtin_version() is 'The version of the built-in step, the application step that runs the test workload: 1. A recorded constant. Callable by no API role.';
comment on function jobs.builtin_kind() is 'The one kind of Job that api.submit_job accepts and the built-in step runs: test_workload. A recorded constant. Callable by no API role.';

-- Shapes -----------------------------------------------------------------------------------------------------------------------------------

-- A list of kinds a worker serves: 1 to 8 distinct words.
create function jobs.kinds_valid(p_kinds text[]) returns boolean
language sql
immutable
set search_path = ''
as $$
  select p_kinds is not null
     and array_ndims(p_kinds) = 1
     and cardinality(p_kinds) between 1 and 8
     and not exists (select 1 from unnest(p_kinds) k where k is null or k !~ '^[a-z][a-z0-9_]{0,39}$')
     and cardinality(p_kinds) = (select count(distinct k) from unnest(p_kinds) k)
$$;

comment on function jobs.kinds_valid(text[]) is 'Whether a list of worker kinds is 1 to 8 distinct lower-case words. Callable by no API role.';

-- The plan of an attempt: {outcome: complete | fail (default complete), operations: [at most 3 of {step_key, ordinal 1 to 100, schedule_id, provider, model, api_version, request_bytes,
-- image_count, output_limit, options}]} with a unique (step_key, ordinal), at most 4 KB. Strict: an unknown member is as bad as a missing one.
create function jobs.plan_valid(p_plan jsonb) returns boolean
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_operation jsonb;
  v_key text;
  v_seen text[] := '{}';
  v_pair text;
begin
  if p_plan is null or jsonb_typeof(p_plan) <> 'object' or octet_length(p_plan::text) > 4096 then
    return false;
  end if;
  for v_key in select jsonb_object_keys(p_plan) loop
    if v_key not in ('outcome', 'operations') then
      return false;
    end if;
  end loop;
  if p_plan ? 'outcome' and (jsonb_typeof(p_plan -> 'outcome') <> 'string' or (p_plan ->> 'outcome') not in ('complete', 'fail')) then
    return false;
  end if;
  if p_plan ? 'operations' then
    if jsonb_typeof(p_plan -> 'operations') <> 'array' or jsonb_array_length(p_plan -> 'operations') > 3 then
      return false;
    end if;
    for v_operation in select e.value from jsonb_array_elements(p_plan -> 'operations') as e(value) loop
      if jsonb_typeof(v_operation) <> 'object' then
        return false;
      end if;
      for v_key in select jsonb_object_keys(v_operation) loop
        if v_key not in ('step_key', 'ordinal', 'schedule_id', 'provider', 'model', 'api_version', 'request_bytes', 'image_count', 'output_limit', 'options') then
          return false;
        end if;
      end loop;
      if not (v_operation ?& array['step_key', 'ordinal', 'schedule_id', 'provider', 'model', 'api_version', 'request_bytes', 'image_count', 'output_limit']) then
        return false;
      end if;
      if jsonb_typeof(v_operation -> 'step_key') <> 'string' or (v_operation ->> 'step_key') !~ '^[a-z][a-z0-9_]{0,39}$' then return false; end if;
      if jsonb_typeof(v_operation -> 'ordinal') <> 'number' or (v_operation ->> 'ordinal') !~ '^[1-9][0-9]{0,2}$' or (v_operation ->> 'ordinal')::integer > 100 then return false; end if;
      if jsonb_typeof(v_operation -> 'schedule_id') <> 'string'
         or (v_operation ->> 'schedule_id') !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then return false; end if;
      if jsonb_typeof(v_operation -> 'provider') <> 'string' or (v_operation ->> 'provider') !~ '^[a-z][a-z0-9._-]{0,79}$' then return false; end if;
      if jsonb_typeof(v_operation -> 'model') <> 'string' or (v_operation ->> 'model') !~ '^[a-z][a-z0-9._-]{0,79}$' then return false; end if;
      if jsonb_typeof(v_operation -> 'api_version') <> 'string' or (v_operation ->> 'api_version') !~ '^[!-~]{1,100}$' then return false; end if;
      if jsonb_typeof(v_operation -> 'request_bytes') <> 'number' or (v_operation ->> 'request_bytes') !~ '^(0|[1-9][0-9]{0,17})$' then return false; end if;
      if jsonb_typeof(v_operation -> 'image_count') <> 'number' or (v_operation ->> 'image_count') !~ '^(0|[1-9][0-9]{0,8})$' then return false; end if;
      if jsonb_typeof(v_operation -> 'output_limit') <> 'number' or (v_operation ->> 'output_limit') !~ '^(0|[1-9][0-9]{0,8})$' then return false; end if;
      if v_operation ? 'options' and jsonb_typeof(v_operation -> 'options') <> 'object' then return false; end if;
      v_pair := (v_operation ->> 'step_key') || ':' || (v_operation ->> 'ordinal');
      if v_pair = any (v_seen) then
        return false;
      end if;
      v_seen := v_seen || v_pair;
    end loop;
  end if;
  return true;
end;
$$;

comment on function jobs.plan_valid(jsonb) is
  'Whether a plan is {outcome: complete | fail, operations: [at most 3 planned operations with a unique (step_key, ordinal)]}, strictly, within 4 KB. Callable by no API role.';

-- The workers (the registry, global) ----------------------------------------------------------------------------------------------------

create table jobs.workers (
  id uuid primary key default gen_random_uuid(),
  -- The service that signs for the worker: the CAD worker or the engine worker.
  issuer text not null check (issuer in ('cad-worker', 'engine-worker')),
  worker_kind text not null check (worker_kind ~ '^[a-z][a-z0-9_]{0,39}$'),
  version integer not null check (version >= 1),
  -- The digest of the immutable image the worker runs.
  image_digest text not null check (image_digest ~ '^[0-9a-f]{64}$'),
  -- The kinds of Job it serves.
  kinds text[] not null check (jobs.kinds_valid(kinds)),
  registered_at timestamptz not null default clock_timestamp(),
  retired_at timestamptz,
  constraint workers_registration_key unique (issuer, version, image_digest),
  constraint workers_retired_shape check (retired_at is null or retired_at >= registered_at)
);

comment on table jobs.workers is
  'The registry of compatible workers (Story 2.7), global. A row is never edited but for its one retirement; registering a version retires the earlier versions of the same (issuer, worker kind). Truncate is refused; delete is left for the Epic 8 purge.';

create index workers_kind_idx on jobs.workers (issuer, worker_kind, version desc);

create function jobs.guard_worker_change() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE' and old.retired_at is null and new.retired_at is not null
     and (to_jsonb(new) - 'retired_at') = (to_jsonb(old) - 'retired_at') then
    return new;
  end if;
  raise exception 'jobs.workers: a worker is retired once, never edited or emptied' using errcode = '55000';
end;
$$;

create trigger workers_guard before update on jobs.workers
  for each row execute function jobs.guard_worker_change();
create trigger workers_no_truncate before truncate on jobs.workers
  for each statement execute function jobs.refuse_change();

-- The outbox (one row for each attempt) --------------------------------------------------------------------------------------------------

create table jobs.outbox (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null,
  job_id uuid not null,
  attempt_id uuid not null,
  kind text not null check (kind ~ '^[a-z][a-z0-9_]{0,39}$'),
  -- The deterministic work the attempt runs (jobs.plan_valid): at most 4 KB.
  plan jsonb not null check (jobs.plan_valid(plan)),
  -- What the attempt is fenced to: the Account's authorization epoch and the Project's revision when it was created.
  account_epoch bigint not null check (account_epoch >= 1),
  project_revision bigint not null check (project_revision >= 1),
  -- The worker version the attempt is pinned to; the built-in step is version 1.
  worker_version integer not null check (worker_version >= 1),
  created_at timestamptz not null default clock_timestamp(),
  -- A publisher holds the row until this time (null: never claimed).
  publish_until timestamptz,
  published_at timestamptz,
  message_id text check (message_id ~ '^[!-~]{1,200}$'),
  constraint outbox_attempt_fkey foreign key (attempt_id, job_id, account_id) references jobs.attempts (id, job_id, account_id) on delete restrict,
  -- One row for each attempt.
  constraint outbox_attempt_key unique (attempt_id),
  constraint outbox_publication_shape check ((published_at is null) = (message_id is null))
);

comment on table jobs.outbox is
  'The dispatch outbox (Story 2.7): one row for every attempt, written by a trigger in the transaction of the attempt. Only the publisher''s lease and the one-time published_at and message_id change. Truncate is refused; delete is left for the Epic 8 purge.';

create index outbox_unpublished_idx on jobs.outbox (created_at, id) where published_at is null;

create function jobs.guard_outbox_change() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if (to_jsonb(new) - 'publish_until' - 'published_at' - 'message_id') is distinct from (to_jsonb(old) - 'publish_until' - 'published_at' - 'message_id') then
    raise exception 'jobs.outbox: what an attempt is pinned to is not changed' using errcode = '55000';
  end if;
  if old.published_at is not null
     and (new.published_at is distinct from old.published_at or new.message_id is distinct from old.message_id or new.publish_until is distinct from old.publish_until) then
    raise exception 'jobs.outbox: a published row is not changed' using errcode = '55000';
  end if;
  return new;
end;
$$;

create trigger outbox_guard before update on jobs.outbox
  for each row execute function jobs.guard_outbox_change();
create trigger outbox_no_truncate before truncate on jobs.outbox
  for each statement execute function jobs.refuse_change();

-- Every attempt commits with its outbox row. The Account's current epoch, the Project's current revision, the worker version and the plan are pinned here; the version and the plan come
-- from transaction-local settings that only api.submit_job sets (a retry has none, and so keeps the version of the attempt before it and runs the plan `{}`).
create function jobs.create_outbox() returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_kind text;
  v_epoch bigint;
  v_revision bigint;
  v_plan jsonb;
  v_version integer;
  v_setting text;
begin
  select j.kind, p.revision, a.authorization_epoch
    into v_kind, v_revision, v_epoch
    from jobs.jobs j
    join projects.projects p on p.id = j.project_id and p.account_id = j.account_id
    join identity.accounts a on a.id = j.account_id
   where j.id = new.job_id;
  v_setting := nullif(current_setting('nova3d.job_plan', true), '');
  v_plan := coalesce(v_setting::jsonb, '{}'::jsonb);
  v_setting := nullif(current_setting('nova3d.job_worker_version', true), '');
  v_version := coalesce(v_setting::integer, (select o.worker_version from jobs.outbox o where o.attempt_id = new.previous_attempt_id), jobs.builtin_version());
  insert into jobs.outbox (account_id, job_id, attempt_id, kind, plan, account_epoch, project_revision, worker_version)
    values (new.account_id, new.job_id, new.id, v_kind, v_plan, v_epoch, v_revision, v_version);
  return null;
end;
$$;

comment on function jobs.create_outbox() is
  'After an attempt is inserted: its outbox row, pinning the Account''s epoch, the Project''s revision, the worker version and the plan. Callable by no API role.';

create trigger attempts_outbox after insert on jobs.attempts
  for each row execute function jobs.create_outbox();

-- The leases (at most one for an attempt) ---------------------------------------------------------------------------------------------------

create table jobs.leases (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null,
  attempt_id uuid not null,
  -- The registered worker that claimed; null for the built-in step.
  worker_id uuid references jobs.workers (id) on delete restrict,
  -- The fencing token: random, handed out once, unique. A copy of it with an ended lease is worth nothing.
  fence uuid not null default gen_random_uuid(),
  claimed_at timestamptz not null default clock_timestamp(),
  renewed_at timestamptz not null default clock_timestamp(),
  expires_at timestamptz not null,
  ended_at timestamptz,
  end_reason text check (end_reason in ('completed', 'failed', 'cancelled', 'expired', 'revoked')),
  -- Why: the cause behind how the lease ended, since the attempt's own reasons are unchanged.
  detail text check (detail in ('user_cancelled', 'account_disabled', 'lease_expired', 'stale_revision', 'revoked_epoch', 'tombstoned', 'step_failed')),
  -- The digest of the result a completed attempt published.
  result_digest text check (result_digest ~ '^[0-9a-f]{64}$'),
  constraint leases_attempt_fkey foreign key (attempt_id, account_id) references jobs.attempts (id, account_id) on delete restrict,
  constraint leases_attempt_key unique (attempt_id),
  constraint leases_fence_key unique (fence),
  constraint leases_time_shape check (renewed_at >= claimed_at and expires_at > claimed_at and (ended_at is null or ended_at >= claimed_at)),
  constraint leases_end_shape check (
    (ended_at is null and end_reason is null and detail is null and result_digest is null)
    or (ended_at is not null and end_reason is not null and (
         (end_reason = 'completed' and detail is null)
         or (end_reason = 'failed' and detail = 'step_failed' and result_digest is null)
         or (end_reason = 'cancelled' and detail = 'user_cancelled' and result_digest is null)
         or (end_reason = 'expired' and detail = 'lease_expired' and result_digest is null)
         or (end_reason = 'revoked' and detail in ('account_disabled', 'revoked_epoch', 'tombstoned', 'stale_revision') and result_digest is null)
       ))
  )
);

comment on table jobs.leases is
  'The leases of attempts (Story 2.7): at most one for an attempt, with a fencing token. A live lease is extended; a lease is ended once and then never changes. Truncate is refused; delete is left for the Epic 8 purge.';

create index leases_live_idx on jobs.leases (expires_at) where ended_at is null;

create function jobs.guard_lease_change() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.id is distinct from old.id or new.account_id is distinct from old.account_id or new.attempt_id is distinct from old.attempt_id
     or new.worker_id is distinct from old.worker_id or new.fence is distinct from old.fence or new.claimed_at is distinct from old.claimed_at then
    raise exception 'jobs.leases: an identity column is not changed' using errcode = '55000';
  end if;
  if old.ended_at is not null then
    raise exception 'jobs.leases: an ended lease is not changed' using errcode = '55000';
  end if;
  if new.ended_at is null then
    -- An extension: only the renewal time and the expiry move, forward, and only while the lease is live.
    if new.end_reason is not null or new.detail is not null or new.result_digest is not null then
      raise exception 'jobs.leases: a live lease has no ending' using errcode = '55000';
    end if;
    if old.expires_at <= clock_timestamp() then
      raise exception 'jobs.leases: an expired lease is never extended' using errcode = '55000';
    end if;
    if new.renewed_at < old.renewed_at or new.expires_at < old.expires_at then
      raise exception 'jobs.leases: a lease is only extended forward' using errcode = '55000';
    end if;
  elsif new.renewed_at is distinct from old.renewed_at or new.expires_at is distinct from old.expires_at then
    raise exception 'jobs.leases: a lease is ended without being extended' using errcode = '55000';
  end if;
  return new;
end;
$$;

create trigger leases_guard before update on jobs.leases
  for each row execute function jobs.guard_lease_change();
create trigger leases_no_truncate before truncate on jobs.leases
  for each statement execute function jobs.refuse_change();

-- The callbacks (the jti of every accepted signed worker command) ---------------------------------------------------------------------------

create table jobs.callbacks (
  -- The token's `jti` (128 random bits, base64url): the primary key is what makes a signed command single-use.
  jti text primary key check (jti ~ '^[A-Za-z0-9_-]{22}$'),
  issuer text not null check (issuer in ('cad-worker', 'engine-worker')),
  kid text not null check (kid ~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$'),
  typ text not null check (typ ~ '^[a-z][a-z0-9-]{0,31}$'),
  command text not null check (command in ('register', 'claim', 'renew', 'step', 'operation', 'finish')),
  -- The attempt the command is about (null for a registration). Not a foreign key: a callback is a record of what was presented, not of what exists.
  attempt_id uuid,
  -- The SHA-256 of the raw body the token vouches for.
  digest text not null check (digest ~ '^[0-9a-f]{64}$'),
  created_at timestamptz not null default clock_timestamp()
);

comment on table jobs.callbacks is
  'One row for every signed worker command that was accepted (Story 2.7): the jti (primary key), issuer, key ID, type, command, attempt and body digest. Never edited. Truncate is refused; delete is left for the Epic 8 purge.';

create trigger callbacks_no_update before update on jobs.callbacks
  for each row execute function jobs.refuse_change();
create trigger callbacks_no_truncate before truncate on jobs.callbacks
  for each statement execute function jobs.refuse_change();

-- Closed by default -----------------------------------------------------------------------------------------------------------------------

alter table jobs.workers enable row level security;
alter table jobs.outbox enable row level security;
alter table jobs.leases enable row level security;
alter table jobs.callbacks enable row level security;
revoke all on jobs.workers from public, anon, authenticated, service_role;
revoke all on jobs.outbox from public, anon, authenticated, service_role;
revoke all on jobs.leases from public, anon, authenticated, service_role;
revoke all on jobs.callbacks from public, anon, authenticated, service_role;

-- The receipts of the two new commands ------------------------------------------------------------------------------------------------------

alter table jobs.commands drop constraint commands_kind_check;
alter table jobs.commands add constraint commands_kind_check
  check (kind in ('accept_job', 'begin_step', 'advance_operation', 'move_attempt', 'request_retry', 'submit_job', 'cancel_job'));

-- A step and an operation may now be PLANNED for a waiting attempt (api.submit_job does); api.begin_step still answers `not_running` for it.
create or replace function jobs.check_step() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if not exists (select 1 from jobs.attempts a where a.id = new.attempt_id and a.state in ('waiting', 'running')) then
    raise exception 'jobs.steps: a step is added to a waiting or running attempt' using errcode = '23514';
  end if;
  return new;
end;
$$;

create or replace function jobs.check_operation() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.state <> 'planned' or new.request_id is not null then
    raise exception 'jobs.operations: an operation is created planned' using errcode = '23514';
  end if;
  if not exists (select 1 from jobs.steps s join jobs.attempts a on a.id = s.attempt_id where s.id = new.step_id and a.state in ('waiting', 'running')) then
    raise exception 'jobs.operations: an operation is added to a waiting or running attempt' using errcode = '23514';
  end if;
  return new;
end;
$$;

-- Internal helpers ------------------------------------------------------------------------------------------------------------------------

-- A UUID derived from a kind and its parts: the command ID of a nested command, so the same step, operation or settlement always finds its own receipt.
create function jobs.derived_id(p_kind text, p_parts text[]) returns uuid
language sql
immutable
set search_path = ''
as $$
  select encode(substring(sha256(convert_to('nova3d:jobs:' || p_kind || ':' || coalesce(array_to_string(p_parts, ':'), ''), 'UTF8')) from 1 for 16), 'hex')::uuid
$$;

comment on function jobs.derived_id(text, text[]) is 'A deterministic UUID from a kind and its parts, for the nested commands of a worker''s command. Callable by no API role.';

-- Whether somebody can run the attempt: the built-in step when it is pinned to the built-in version and its kind is built in, or a registered worker that is not retired, has the pinned
-- version and lists the kind.
create function jobs.executable(p_attempt_id uuid) returns boolean
language sql
stable
set search_path = ''
as $$
  select exists (
    select 1
      from jobs.outbox o
     where o.attempt_id = p_attempt_id
       and ((o.worker_version = jobs.builtin_version() and o.kind = jobs.builtin_kind())
            or exists (select 1 from jobs.workers w where w.retired_at is null and w.version = o.worker_version and o.kind = any (w.kinds)))
  )
$$;

comment on function jobs.executable(uuid) is 'Whether the built-in step or a registered, compatible worker can run the attempt. Callable by no API role.';

-- The reason an attempt SHOWS in the Story 2.7 reads: the stored one, except for a waiting attempt, whose reason is derived: awaiting_reconciliation (the gate), then awaiting_worker (nobody
-- can run it), then awaiting_dispatch. (jobs.derived_reason of Story 2.11 is unchanged and knows nothing of workers.)
create function jobs.shown_reason(p_attempt_id uuid, p_job_id uuid, p_number integer, p_state text, p_reason text) returns text
language sql
stable
set search_path = ''
as $$
  select case
    when p_state = 'waiting' then
      case
        when jobs.charge_open(p_job_id, p_number) then 'awaiting_reconciliation'
        when not jobs.executable(p_attempt_id) then 'awaiting_worker'
        else 'awaiting_dispatch'
      end
    else p_reason
  end
$$;

comment on function jobs.shown_reason(uuid, uuid, integer, text, text) is
  'The reason an attempt shows in the Story 2.7 reads: stored, except a waiting attempt''s, which is awaiting_reconciliation, awaiting_worker or awaiting_dispatch. Callable by no API role.';

-- Why the Account's authority is gone, as the lease records it.
create function jobs.authority_detail(p_account_id uuid) returns text
language sql
stable
set search_path = ''
as $$
  select case
    when lifecycle.is_tombstoned('account', p_account_id) then 'tombstoned'
    when coalesce((select a.status from identity.accounts a where a.id = p_account_id), 'disabled') <> 'active' then 'account_disabled'
    else 'revoked_epoch'
  end
$$;

comment on function jobs.authority_detail(uuid) is 'Why the Account''s authority is gone: tombstoned, account_disabled or revoked_epoch. Callable by no API role.';

-- Ends an open attempt without asking for any authority: the lease FIRST (so a late result has nowhere to land), then what never went out is abandoned, then the attempt moves. The caller
-- holds the Job's lock and releases the money after (jobs.settle_abandoned).
create function jobs.end_attempt(p_attempt_id uuid, p_to text, p_reason text, p_lease_reason text, p_lease_detail text) returns jobs.attempts
language plpgsql
set search_path = ''
as $$
declare
  v_attempt jobs.attempts;
begin
  select * into v_attempt from jobs.attempts a where a.id = p_attempt_id for update;
  if not found or v_attempt.state not in ('waiting', 'running') then
    raise exception 'jobs.end_attempt: only an open attempt is ended' using errcode = '55000';
  end if;
  update jobs.leases l
     set ended_at = clock_timestamp(), end_reason = p_lease_reason, detail = p_lease_detail
   where l.attempt_id = p_attempt_id and l.ended_at is null;
  update jobs.operations o
     set state = 'abandoned'
    from jobs.steps s
   where s.id = o.step_id and s.attempt_id = p_attempt_id and o.state = 'planned';
  update jobs.attempts a
     set state = p_to, reason = p_reason, ended_at = clock_timestamp()
   where a.id = p_attempt_id
   returning * into v_attempt;
  return v_attempt;
end;
$$;

comment on function jobs.end_attempt(uuid, text, text, text, text) is
  'Ends an open attempt with no authority check: its lease first, then its planned operations are abandoned, then the attempt moves. The caller holds the Job lock. Callable by no API role.';

-- Releases what never went out: every abandoned operation that holds a reservation and has no settlement is settled `unused` (the whole reservation released, nothing charged). One
-- attempt, one Account, or all of them. Dispatched and ambiguous operations are never touched here: they stay chargeable and held.
create function jobs.settle_abandoned(p_attempt_id uuid default null, p_account_id uuid default null, p_limit integer default 100) returns integer
language plpgsql
set search_path = ''
as $$
declare
  r record;
  v_result api.cost_settlement;
  v_settled integer := 0;
begin
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
    v_result := api.settle_cost(r.account_id, jobs.derived_id('settle_unused', array[r.operation_id::text]), r.operation_id, 'unused');
    if v_result.outcome = 'settled' then
      v_settled := v_settled + 1;
    elsif v_result.outcome not in ('replayed', 'already_settled') then
      raise exception 'jobs.settle_abandoned: an abandoned operation was not settled (%)', v_result.outcome using errcode = '55000';
    end if;
  end loop;
  return v_settled;
end;
$$;

comment on function jobs.settle_abandoned(uuid, uuid, integer) is
  'Settles `unused` every abandoned operation that holds a reservation and has no settlement, releasing it; returns how many. Callable by no API role.';

-- The ONE place a planned operation is reserved (Story 2.5 adds its permission argument here and nowhere else): the twelve-argument api.reserve_cost, which refuses a permissioned provider.
create function jobs.reserve_planned(p_account_id uuid, p_epoch bigint, p_command_id uuid, p_operation_id uuid, p_operation jsonb) returns api.cost_reservation
language sql
set search_path = ''
as $$
  select api.reserve_cost(
    p_account_id, p_epoch, p_command_id, p_operation_id,
    (p_operation ->> 'schedule_id')::uuid, p_operation ->> 'provider', p_operation ->> 'model', p_operation ->> 'api_version',
    (p_operation ->> 'request_bytes')::bigint, (p_operation ->> 'image_count')::integer, (p_operation ->> 'output_limit')::integer,
    coalesce(p_operation -> 'options', '{}'::jsonb))
$$;

comment on function jobs.reserve_planned(uuid, bigint, uuid, uuid, jsonb) is
  'Reserves one planned operation of a plan through api.reserve_cost. The single place the reservation of a Job''s planned operation is asked. Callable by no API role.';

-- The answer of the check every fenced command makes: `ok` with the facts the command needs, or the word of the refusal.
create type jobs.fence_check as (
  outcome text,
  lease_end_reason text,
  account_id uuid,
  epoch bigint,
  job_id uuid,
  project_id uuid,
  attempt_number integer,
  kind text,
  project_revision bigint,
  input_digest text
);

-- The check of every fenced command, in the order the story fixes. The Account and the Project are taken first (the order of every other command), then the Job's lock; the answer is decided
-- in order: the lease by fence belongs to the attempt, is not ended, has an expiry in the future, the attempt is running, the authority holds with the bound epoch (otherwise the lease is
-- ended and the attempt cancelled), the Project is held. Replays are the caller's: a lease ended `completed` or `failed` is answered `not_running` with its end reason.
create function jobs.check_fence(p_attempt_id uuid, p_fence uuid) returns jobs.fence_check
language plpgsql
set search_path = ''
as $$
declare
  v_result jobs.fence_check;
  v_attempt jobs.attempts;
  v_outbox jobs.outbox;
  v_project_id uuid;
  v_lease jobs.leases;
  v_authority boolean;
  v_held boolean := false;
  v_detail text;
begin
  select * into v_attempt from jobs.attempts a where a.id = p_attempt_id;
  select * into v_outbox from jobs.outbox o where o.attempt_id = p_attempt_id;
  if v_attempt.id is null or v_outbox.id is null then
    v_result.outcome := 'fence_mismatch';
    return v_result;
  end if;
  select j.project_id into v_project_id from jobs.jobs j where j.id = v_attempt.job_id;
  v_result.account_id := v_attempt.account_id;
  v_result.epoch := v_outbox.account_epoch;
  v_result.job_id := v_attempt.job_id;
  v_result.project_id := v_project_id;
  v_result.attempt_number := v_attempt.number;
  v_result.kind := v_outbox.kind;
  v_result.project_revision := v_outbox.project_revision;
  v_result.input_digest := v_attempt.input_digest;

  -- The Account, then the Project (FOR SHARE: a disable and a tombstone wait for this transaction), then the Job's lock.
  begin
    perform identity.assert_operation_authority(v_attempt.account_id, v_outbox.account_epoch);
    v_authority := true;
  exception when sqlstate 'N3010' then
    v_authority := false;
  end;
  if v_authority then
    v_held := jobs.hold_project(v_attempt.account_id, v_project_id);
  end if;
  perform pg_advisory_xact_lock(hashtextextended('nova3d:job:' || v_attempt.job_id::text, 0));

  -- 1. The lease by fence belongs to the attempt.
  select * into v_lease from jobs.leases l where l.attempt_id = p_attempt_id and l.fence = p_fence;
  if not found then
    v_result.outcome := 'fence_mismatch';
    return v_result;
  end if;
  -- 2. It is not ended.
  if v_lease.ended_at is not null then
    v_result.outcome := case v_lease.end_reason when 'cancelled' then 'cancelled' when 'expired' then 'expired' when 'revoked' then 'revoked' else 'not_running' end;
    v_result.lease_end_reason := v_lease.end_reason;
    return v_result;
  end if;
  -- 3. Its expiry is in the future (the sweep ends it; a late command changes nothing).
  if v_lease.expires_at <= clock_timestamp() then
    v_result.outcome := 'expired';
    return v_result;
  end if;
  -- 4. The attempt is running.
  select * into v_attempt from jobs.attempts a where a.id = p_attempt_id for update;
  if v_attempt.state <> 'running' then
    v_result.outcome := 'not_running';
    return v_result;
  end if;
  -- 5. The authority holds with the epoch the attempt is bound to. Otherwise the lease is ended and the attempt cancelled FIRST.
  if not v_authority then
    v_detail := jobs.authority_detail(v_attempt.account_id);
    perform jobs.end_attempt(p_attempt_id, 'cancelled', 'account_disabled', 'revoked', v_detail);
    perform jobs.settle_abandoned(p_attempt_id);
    v_result.outcome := 'revoked';
    return v_result;
  end if;
  -- 6. The Project is held: live, the Account's own and without a tombstone.
  if not v_held then
    v_result.outcome := 'unavailable';
    return v_result;
  end if;
  v_result.outcome := 'ok';
  return v_result;
end;
$$;

comment on function jobs.check_fence(uuid, uuid) is
  'The check every fenced command makes, in order: the fence belongs to the attempt, the lease is not ended, it has not expired, the attempt is running, the authority holds with the bound epoch (otherwise the lease is ended and the attempt cancelled), the Project is held. Callable by no API role.';

-- The command: submit ----------------------------------------------------------------------------------------------------------------------

-- outcome: accepted | replayed | reused | denied | unavailable | at_capacity | refused. accepted and replayed carry the Job, attempt 1 and its outbox row. at_capacity carries the number
-- of open Jobs and the limit. refused carries the refusal word of the reservation (and its reason) and the exact cost block; nothing was written.
create type api.dispatch_submission as (
  outcome text,
  job_id uuid,
  attempt_id uuid,
  outbox_id uuid,
  attempt_number integer,
  state text,
  stage text,
  reason text,
  open_jobs integer,
  open_limit integer,
  refusal text,
  refusal_reason text,
  refusal_detail text,
  requested_microdollars bigint,
  limit_microdollars bigint,
  used_microdollars bigint,
  available_microdollars bigint
);

create function api.submit_job(
  p_account_id uuid, p_epoch bigint, p_command_id uuid, p_project_id uuid, p_kind text, p_input_digest text,
  p_plan jsonb default '{}'::jsonb, p_worker_version integer default null
) returns api.dispatch_submission
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_result api.dispatch_submission;
  v_digest text;
  v_command jobs.commands;
  v_job jobs.jobs;
  v_attempt jobs.attempts;
  v_outbox jobs.outbox;
  v_open integer;
  v_operation jsonb;
  v_step_id uuid;
  v_operation_id uuid;
  v_reservation api.cost_reservation;
  v_detail text;
begin
  -- 1. The arguments: the one kind that runs today, a digest, a plan of the shape the outbox holds and a worker version.
  if p_account_id is null or p_epoch is null or p_epoch < 1 or p_command_id is null or p_project_id is null
     or p_kind is null or p_kind <> jobs.builtin_kind()
     or p_input_digest is null or p_input_digest !~ '^[0-9a-f]{64}$'
     or p_plan is null or not jobs.plan_valid(p_plan)
     or (p_worker_version is not null and p_worker_version < 1) then
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
  v_digest := jobs.command_digest('submit_job', array[p_project_id::text, p_kind, p_input_digest, p_plan::text, p_worker_version::text]);
  select * into v_command from jobs.commands c where c.account_id = p_account_id and c.command_id = p_command_id;
  if found then
    if v_command.digest <> v_digest or v_command.kind <> 'submit_job' then
      v_result.outcome := 'reused';
      return v_result;
    end if;
    select * into v_attempt from jobs.attempts a where a.job_id = v_command.subject_id and a.number = 1;
    select * into v_outbox from jobs.outbox o where o.attempt_id = v_attempt.id;
    v_result.outcome := 'replayed';
    v_result.job_id := v_attempt.job_id;
    v_result.attempt_id := v_attempt.id;
    v_result.outbox_id := v_outbox.id;
    v_result.attempt_number := v_attempt.number;
    v_result.state := v_attempt.state;
    v_result.stage := v_attempt.stage;
    v_result.reason := jobs.shown_reason(v_attempt.id, v_attempt.job_id, v_attempt.number, v_attempt.state, v_attempt.reason);
    return v_result;
  end if;

  -- 7. Capacity: at most three Jobs with an open attempt. The count and the new Job are one step under a lock of the Account's own, so two submissions cannot both pass.
  perform pg_advisory_xact_lock(hashtextextended('nova3d:jobs-open:' || p_account_id::text, 0));
  select count(*)::integer into v_open from jobs.attempts a where a.account_id = p_account_id and a.state in ('waiting', 'running');
  if v_open >= jobs.open_job_limit() then
    v_result.outcome := 'at_capacity';
    v_result.open_jobs := v_open;
    v_result.open_limit := jobs.open_job_limit();
    return v_result;
  end if;

  -- 8. The Job, its first attempt (the trigger writes the outbox row), each planned operation and its reservation: all of it, or none of it.
  begin
    perform set_config('nova3d.job_plan', p_plan::text, true);
    perform set_config('nova3d.job_worker_version', coalesce(p_worker_version, jobs.builtin_version())::text, true);
    insert into jobs.jobs (account_id, project_id, kind) values (p_account_id, p_project_id, p_kind) returning * into v_job;
    insert into jobs.attempts (account_id, job_id, number, previous_attempt_id, input_digest, state, stage)
      values (p_account_id, v_job.id, 1, null, p_input_digest, 'waiting', 'accepted')
      returning * into v_attempt;
    perform set_config('nova3d.job_plan', '', true);
    perform set_config('nova3d.job_worker_version', '', true);
    select * into v_outbox from jobs.outbox o where o.attempt_id = v_attempt.id;
    for v_operation in
      select e.value from jsonb_array_elements(coalesce(p_plan -> 'operations', '[]'::jsonb)) with ordinality as e(value, idx) order by e.idx
    loop
      select s.id into v_step_id from jobs.steps s where s.attempt_id = v_attempt.id and s.step_key = v_operation ->> 'step_key';
      if v_step_id is null then
        insert into jobs.steps (account_id, attempt_id, step_key) values (p_account_id, v_attempt.id, v_operation ->> 'step_key') returning id into v_step_id;
      end if;
      insert into jobs.operations (account_id, step_id, ordinal, state)
        values (p_account_id, v_step_id, (v_operation ->> 'ordinal')::integer, 'planned')
        returning id into v_operation_id;
      v_reservation := jobs.reserve_planned(
        p_account_id, p_epoch, jobs.derived_id('reserve', array[v_job.id::text, v_operation ->> 'step_key', v_operation ->> 'ordinal']), v_operation_id, v_operation);
      if v_reservation.outcome <> 'reserved' then
        -- Everything above is undone with this block: no Job, outbox row, operation, reservation or receipt.
        raise exception using errcode = 'N3050', message = 'refused', detail = to_jsonb(v_reservation)::text;
      end if;
    end loop;
  exception when sqlstate 'N3050' then
    get stacked diagnostics v_detail = pg_exception_detail;
    v_reservation := jsonb_populate_record(null::api.cost_reservation, v_detail::jsonb);
    v_result.outcome := 'refused';
    v_result.refusal := v_reservation.outcome;
    v_result.refusal_reason := v_reservation.reason;
    v_result.refusal_detail := v_reservation.detail;
    v_result.requested_microdollars := v_reservation.requested_microdollars;
    v_result.limit_microdollars := v_reservation.limit_microdollars;
    v_result.used_microdollars := v_reservation.used_microdollars;
    v_result.available_microdollars := v_reservation.available_microdollars;
    return v_result;
  end;
  perform jobs.record_command(p_account_id, p_command_id, 'submit_job', v_digest, v_job.id);

  v_result.outcome := 'accepted';
  v_result.job_id := v_job.id;
  v_result.attempt_id := v_attempt.id;
  v_result.outbox_id := v_outbox.id;
  v_result.attempt_number := v_attempt.number;
  v_result.state := v_attempt.state;
  v_result.stage := v_attempt.stage;
  v_result.reason := jobs.shown_reason(v_attempt.id, v_job.id, v_attempt.number, v_attempt.state, v_attempt.reason);
  return v_result;
end;
$$;

comment on function api.submit_job(uuid, bigint, uuid, uuid, text, text, jsonb, integer) is
  'Commits a test_workload Job of a live Project, its first attempt (waiting, stage accepted), the outbox row that pins the Account''s epoch, the Project''s revision, the worker version and the plan, each planned operation and its reservation, or nothing. accepted | replayed | reused | denied | unavailable | at_capacity (carries the open count and the limit of 3) | refused (carries the refusal word and the exact cost block; nothing is written).';

-- The command: cancel ----------------------------------------------------------------------------------------------------------------------

-- outcome: cancelled | replayed | reused | denied | unavailable | not_cancellable. The attempt fields are the highest attempt's (for not_cancellable, the state that refused). `released` is how many
-- never-dispatched operations had their reservation released.
create type api.dispatch_cancellation as (
  outcome text,
  job_id uuid,
  attempt_id uuid,
  attempt_number integer,
  state text,
  stage text,
  reason text,
  released integer
);

create function api.cancel_job(p_account_id uuid, p_epoch bigint, p_command_id uuid, p_job_id uuid)
returns api.dispatch_cancellation
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_result api.dispatch_cancellation;
  v_project_id uuid;
  v_digest text;
  v_command jobs.commands;
  v_attempt jobs.attempts;
begin
  -- 1. The arguments.
  if p_account_id is null or p_epoch is null or p_epoch < 1 or p_command_id is null or p_job_id is null then
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

  -- 5. One command at a time for a Job.
  perform pg_advisory_xact_lock(hashtextextended('nova3d:job:' || p_job_id::text, 0));

  -- 6. The receipt.
  v_digest := jobs.command_digest('cancel_job', array[p_job_id::text]);
  select * into v_attempt from jobs.attempts a where a.job_id = p_job_id order by a.number desc limit 1 for update;
  select * into v_command from jobs.commands c where c.account_id = p_account_id and c.command_id = p_command_id;
  v_result.job_id := p_job_id;
  v_result.attempt_id := v_attempt.id;
  v_result.attempt_number := v_attempt.number;
  v_result.state := v_attempt.state;
  v_result.stage := v_attempt.stage;
  v_result.reason := jobs.shown_reason(v_attempt.id, p_job_id, v_attempt.number, v_attempt.state, v_attempt.reason);
  if v_command.command_id is not null then
    if v_command.digest <> v_digest or v_command.kind <> 'cancel_job' then
      v_result := null;
      v_result.outcome := 'reused';
      return v_result;
    end if;
    v_result.outcome := 'replayed';
    return v_result;
  end if;

  -- 7. Only an open attempt is cancelled.
  if v_attempt.state not in ('waiting', 'running') then
    v_result.outcome := 'not_cancellable';
    return v_result;
  end if;

  -- The lease ends FIRST (commit authority is revoked before anything else), then the attempt moves, its planned operations are abandoned, and what never went out is released. A
  -- dispatched or ambiguous operation stays chargeable and held.
  v_attempt := jobs.end_attempt(v_attempt.id, 'cancelled', 'user_cancelled', 'cancelled', 'user_cancelled');
  v_result.released := jobs.settle_abandoned(v_attempt.id);
  perform jobs.record_command(p_account_id, p_command_id, 'cancel_job', v_digest, p_job_id);

  v_result.outcome := 'cancelled';
  v_result.state := v_attempt.state;
  v_result.stage := v_attempt.stage;
  v_result.reason := v_attempt.reason;
  return v_result;
end;
$$;

comment on function api.cancel_job(uuid, bigint, uuid, uuid) is
  'Cancels a Job whose highest attempt is waiting or running: its lease ends first (cancelled, user_cancelled), then the attempt moves to cancelled/user_cancelled, its planned operations are abandoned and each one that holds a reservation is released (settled unused); dispatched and ambiguous operations stay chargeable and held. cancelled | replayed | reused | denied | unavailable | not_cancellable (carries the state).';

-- The reads --------------------------------------------------------------------------------------------------------------------------------

-- found: the Account's Jobs whose Project is live: open attempts first, then the newest ended, each with the Project and its title, the kind, the public state, stage and reason (with
-- awaiting_worker) and the times of the highest attempt.
create type api.dispatch_listing as (
  outcome text,
  items jsonb
);

create function api.list_jobs(p_account_id uuid, p_epoch bigint, p_limit integer default 50)
returns api.dispatch_listing
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_result api.dispatch_listing;
begin
  if p_account_id is null or p_epoch is null or p_epoch < 1 or p_limit is null or p_limit not between 1 and 200 then
    raise exception 'invalid argument' using errcode = '22023';
  end if;

  begin
    perform identity.assert_operation_authority(p_account_id, p_epoch);
  exception when sqlstate 'N3010' then
    v_result.outcome := 'denied';
    return v_result;
  end;

  v_result.outcome := 'found';
  -- ONE statement, so one snapshot: the state of each Job is its highest attempt's.
  select coalesce(jsonb_agg(x.item order by x.is_open desc, x.sort_at desc, x.job_id), '[]'::jsonb)
    into v_result.items
    from (
      select t.is_open, t.sort_at, t.job_id,
             jsonb_build_object(
               'job_id', t.job_id, 'project_id', t.project_id, 'project_title', t.project_title, 'kind', t.kind, 'created_at', t.created_at,
               'attempt_number', t.number, 'state', t.state, 'stage', t.stage,
               'reason', jobs.shown_reason(t.attempt_id, t.job_id, t.number, t.state, t.reason),
               'started_at', t.started_at, 'ended_at', t.ended_at) as item
        from (
          select j.id as job_id, j.project_id, p.title as project_title, j.kind, j.created_at,
                 h.id as attempt_id, h.number, h.state, h.stage, h.reason, h.started_at, h.ended_at,
                 h.state in ('waiting', 'running') as is_open,
                 coalesce(h.ended_at, j.created_at) as sort_at
            from jobs.jobs j
            join projects.projects p on p.id = j.project_id and p.account_id = j.account_id
            cross join lateral (select a.* from jobs.attempts a where a.job_id = j.id order by a.number desc limit 1) h
           where j.account_id = p_account_id and p.deleted_at is null and not lifecycle.is_tombstoned('project', p.id)
           order by (h.state in ('waiting', 'running')) desc, coalesce(h.ended_at, j.created_at) desc, j.id
           limit p_limit
        ) t
    ) x;
  return v_result;
end;
$$;

comment on function api.list_jobs(uuid, bigint, integer) is
  'The Account''s Jobs whose Project is live (at most p_limit, never more than 200): open attempts first, then the newest ended, each with its Project''s ID and title, kind, public state, stage and reason (with awaiting_worker) and times. found | denied.';

-- found: the Job, its public state, stage and reason (with awaiting_worker), whether it can be cancelled and retried, every attempt, its progress (steps begun, operations completed of
-- planned), its cost (microdollars reserved and still held, settled, released, and how many operations are potentially chargeable) and its ending (the lease detail of the highest
-- attempt, null while it is open). Nothing else.
create type api.dispatch_detail as (
  outcome text,
  job_id uuid,
  project_id uuid,
  project_title text,
  kind text,
  created_at timestamptz,
  state text,
  stage text,
  reason text,
  can_cancel boolean,
  can_retry boolean,
  attempts jsonb,
  progress jsonb,
  cost jsonb,
  ending text
);

create function api.read_job_detail(p_account_id uuid, p_epoch bigint, p_job_id uuid)
returns api.dispatch_detail
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_result api.dispatch_detail;
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

  -- ONE statement reads everything, so the Job's state, its attempts, its progress and its cost come from one snapshot and cannot disagree. A Job of the Account's, of a live Project
  -- without a tombstone: a foreign, deleted, unknown and tombstoned one are the same answer.
  select 'found', j.id, j.project_id, p.title, j.kind, j.created_at,
         h.state, h.stage, jobs.shown_reason(h.id, j.id, h.number, h.state, h.reason),
         h.state in ('waiting', 'running'), h.state = 'failed',
         (select coalesce(jsonb_agg(
                   jsonb_build_object(
                     'id', a.id, 'number', a.number, 'state', a.state, 'stage', a.stage,
                     'reason', jobs.shown_reason(a.id, a.job_id, a.number, a.state, a.reason),
                     'created_at', a.created_at, 'started_at', a.started_at, 'ended_at', a.ended_at,
                     'chargeable_operations', (select count(*) from jobs.operations o join jobs.steps t on t.id = o.step_id where t.attempt_id = a.id and o.state in ('dispatched', 'ambiguous'))
                   ) order by a.number), '[]'::jsonb)
            from jobs.attempts a where a.job_id = j.id),
         (select jsonb_build_object(
                   'steps', count(distinct s.id),
                   'steps_begun', count(distinct s.id) filter (where not exists (select 1 from jobs.operations o1 where o1.step_id = s.id)
                                                                   or exists (select 1 from jobs.operations o2 where o2.step_id = s.id and o2.state not in ('planned', 'abandoned'))),
                   'operations_planned', count(o.id),
                   'operations_completed', count(o.id) filter (where o.state = 'completed'))
            from jobs.steps s left join jobs.operations o on o.step_id = s.id where s.attempt_id = h.id),
         (select jsonb_build_object(
                   'held', coalesce(sum(rv.reserved_microdollars) filter (where st.id is null), 0)::bigint,
                   'settled', coalesce(sum(st.settled_microdollars), 0)::bigint,
                   'released', coalesce(sum(greatest(st.released_microdollars - st.settled_microdollars, 0)), 0)::bigint,
                   'chargeable_operations', (select count(*) from jobs.operations o3 join jobs.steps s3 on s3.id = o3.step_id join jobs.attempts a3 on a3.id = s3.attempt_id
                                              where a3.job_id = j.id and o3.state in ('dispatched', 'ambiguous')))
            from usage.reservations rv left join usage.settlements st on st.reservation_id = rv.id where rv.job_id = j.id),
         (select l.detail from jobs.leases l where l.attempt_id = h.id and l.ended_at is not null)
    into v_result.outcome, v_result.job_id, v_result.project_id, v_result.project_title, v_result.kind, v_result.created_at,
         v_result.state, v_result.stage, v_result.reason, v_result.can_cancel, v_result.can_retry,
         v_result.attempts, v_result.progress, v_result.cost, v_result.ending
    from jobs.jobs j
    join projects.projects p on p.id = j.project_id and p.account_id = j.account_id
    cross join lateral (select a.* from jobs.attempts a where a.job_id = j.id order by a.number desc limit 1) h
   where j.id = p_job_id and j.account_id = p_account_id and p.deleted_at is null and not lifecycle.is_tombstoned('project', p.id);
  if not found then
    v_result := null;
    v_result.outcome := 'unavailable';
  end if;
  return v_result;
end;
$$;

comment on function api.read_job_detail(uuid, bigint, uuid) is
  'One Job of the Account: its public state, stage and reason (with awaiting_worker), can_cancel, can_retry, every attempt, progress (steps begun, operations completed of planned), cost (microdollars held, settled and released, and the operations that are potentially chargeable) and ending (the lease detail of the highest attempt, null while open). Read in one statement. found | denied | unavailable.';

-- The registry ------------------------------------------------------------------------------------------------------------------------------

-- outcome: registered | replayed | superseded. worker_id is the worker's (for superseded, the highest non-retired version's); retired counts the earlier versions this registration retired.
create type api.dispatch_registration as (
  outcome text,
  worker_id uuid,
  version integer,
  retired integer
);

create function api.register_worker(p_issuer text, p_worker_kind text, p_version integer, p_image_digest text, p_kinds text[])
returns api.dispatch_registration
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_result api.dispatch_registration;
  v_existing jobs.workers;
  v_higher jobs.workers;
  v_id uuid;
  v_retired integer;
begin
  if p_issuer is null or p_issuer not in ('cad-worker', 'engine-worker')
     or p_worker_kind is null or p_worker_kind !~ '^[a-z][a-z0-9_]{0,39}$'
     or p_version is null or p_version < 1
     or p_image_digest is null or p_image_digest !~ '^[0-9a-f]{64}$'
     or not jobs.kinds_valid(p_kinds) then
    raise exception 'invalid argument' using errcode = '22023';
  end if;

  -- One registration at a time for a worker kind of an issuer.
  perform pg_advisory_xact_lock(hashtextextended('nova3d:workers:' || p_issuer || ':' || p_worker_kind, 0));

  -- The same registration again is a replay; the same version and image registered as something else is not registered again.
  select * into v_existing from jobs.workers w where w.issuer = p_issuer and w.version = p_version and w.image_digest = p_image_digest;
  if found then
    v_result.outcome := case
      when v_existing.worker_kind = p_worker_kind and v_existing.kinds @> p_kinds and v_existing.kinds <@ p_kinds then 'replayed'
      else 'superseded'
    end;
    v_result.worker_id := v_existing.id;
    v_result.version := v_existing.version;
    v_result.retired := 0;
    return v_result;
  end if;

  -- A version that is not above a version still in service is superseded.
  select * into v_higher from jobs.workers w
   where w.issuer = p_issuer and w.worker_kind = p_worker_kind and w.retired_at is null and w.version >= p_version
   order by w.version desc limit 1;
  if found then
    v_result.outcome := 'superseded';
    v_result.worker_id := v_higher.id;
    v_result.version := v_higher.version;
    v_result.retired := 0;
    return v_result;
  end if;

  insert into jobs.workers (issuer, worker_kind, version, image_digest, kinds) values (p_issuer, p_worker_kind, p_version, p_image_digest, p_kinds)
    returning id into v_id;
  update jobs.workers w set retired_at = clock_timestamp()
   where w.issuer = p_issuer and w.worker_kind = p_worker_kind and w.version < p_version and w.retired_at is null;
  get diagnostics v_retired = row_count;
  v_result.retired := v_retired;

  v_result.outcome := 'registered';
  v_result.worker_id := v_id;
  v_result.version := p_version;
  return v_result;
end;
$$;

comment on function api.register_worker(text, text, integer, text, text[]) is
  'Registers a compatible worker (issuer, worker kind, version, image digest, the kinds it serves) and retires the earlier versions of the same (issuer, worker kind). registered | replayed | superseded (the version is not above one still in service).';

-- The claim ------------------------------------------------------------------------------------------------------------------------------------

-- outcome: claimed | replayed | already_claimed | not_waiting | blocked | waiting_for_worker | incompatible | revoked | unavailable. claimed and replayed carry the fence, the expiry, the plan, the input
-- digest, the Project revision and the Account epoch the attempt is bound to; the others carry the attempt's state where it refused.
create type api.dispatch_claim as (
  outcome text,
  attempt_id uuid,
  job_id uuid,
  kind text,
  fence uuid,
  expires_at timestamptz,
  plan jsonb,
  input_digest text,
  project_revision bigint,
  account_epoch bigint,
  worker_version integer,
  state text
);

create function api.claim_attempt(p_attempt_id uuid, p_worker_id uuid default null, p_issuer text default null)
returns api.dispatch_claim
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_result api.dispatch_claim;
  v_attempt jobs.attempts;
  v_outbox jobs.outbox;
  v_project_id uuid;
  v_lease jobs.leases;
  v_worker jobs.workers;
  v_authority boolean;
  v_held boolean := false;
  v_now timestamptz;
begin
  if p_attempt_id is null or (p_issuer is not null and p_issuer not in ('cad-worker', 'engine-worker')) then
    raise exception 'invalid argument' using errcode = '22023';
  end if;

  select * into v_attempt from jobs.attempts a where a.id = p_attempt_id;
  select * into v_outbox from jobs.outbox o where o.attempt_id = p_attempt_id;
  if v_attempt.id is null or v_outbox.id is null then
    v_result.outcome := 'unavailable';
    return v_result;
  end if;
  select j.project_id into v_project_id from jobs.jobs j where j.id = v_attempt.job_id;
  v_result.attempt_id := v_attempt.id;
  v_result.job_id := v_attempt.job_id;
  v_result.kind := v_outbox.kind;
  v_result.plan := v_outbox.plan;
  v_result.input_digest := v_attempt.input_digest;
  v_result.project_revision := v_outbox.project_revision;
  v_result.account_epoch := v_outbox.account_epoch;
  v_result.worker_version := v_outbox.worker_version;

  -- The authority of the epoch the attempt is bound to, then the Project (FOR SHARE), then the Job's lock: the order of every command.
  begin
    perform identity.assert_operation_authority(v_attempt.account_id, v_outbox.account_epoch);
    v_authority := true;
  exception when sqlstate 'N3010' then
    v_authority := false;
  end;
  if v_authority then
    v_held := jobs.hold_project(v_attempt.account_id, v_project_id);
  end if;
  perform pg_advisory_xact_lock(hashtextextended('nova3d:job:' || v_attempt.job_id::text, 0));
  select * into v_attempt from jobs.attempts a where a.id = p_attempt_id for update;
  v_result.state := v_attempt.state;

  -- 0. A worker's identity is bound to the issuer that signed for it: a registered worker named by a token of ANOTHER issuer is not that worker's claimant. Nothing is changed and
  -- no fence is given back (a replay below would hand it out), whatever the state of the attempt.
  if p_worker_id is not null and p_issuer is not null
     and exists (select 1 from jobs.workers w where w.id = p_worker_id and w.issuer <> p_issuer) then
    v_result.outcome := 'incompatible';
    return v_result;
  end if;

  -- 1. A lease of the attempt, live or ended: the same registered worker again is a replay (with its fence), anyone else is too late. A claim is once.
  select * into v_lease from jobs.leases l where l.attempt_id = p_attempt_id;
  if found then
    if p_worker_id is not null and v_lease.worker_id = p_worker_id then
      v_result.outcome := 'replayed';
      v_result.fence := v_lease.fence;
      v_result.expires_at := v_lease.expires_at;
    else
      v_result.outcome := 'already_claimed';
    end if;
    return v_result;
  end if;

  -- 2. Only a waiting attempt is claimed (a finished attempt is never reclaimed).
  if v_attempt.state <> 'waiting' then
    v_result.outcome := 'not_waiting';
    return v_result;
  end if;

  -- 3. The authority holds with the epoch the attempt is bound to; otherwise the attempt is cancelled, with nothing to end but itself.
  if not v_authority then
    perform jobs.end_attempt(p_attempt_id, 'cancelled', 'account_disabled', null, null);
    perform jobs.settle_abandoned(p_attempt_id);
    v_result.outcome := 'revoked';
    v_result.state := 'cancelled';
    return v_result;
  end if;
  if not v_held then
    v_result.outcome := 'unavailable';
    return v_result;
  end if;

  -- 4. THE GATE: a retry does not start while an earlier operation is potentially chargeable.
  if jobs.charge_open(v_attempt.job_id, v_attempt.number) then
    v_result.outcome := 'blocked';
    return v_result;
  end if;

  -- 5. Nobody can run it yet.
  if not jobs.executable(p_attempt_id) then
    v_result.outcome := 'waiting_for_worker';
    return v_result;
  end if;

  -- 6. The claimant is compatible: the built-in step for the built-in version and kind, a registered worker that is not retired, of the pinned version, serving the kind.
  if p_worker_id is null then
    if v_outbox.worker_version <> jobs.builtin_version() or v_outbox.kind <> jobs.builtin_kind() then
      v_result.outcome := 'incompatible';
      return v_result;
    end if;
  else
    select * into v_worker from jobs.workers w where w.id = p_worker_id;
    if not found or v_worker.retired_at is not null or v_worker.version <> v_outbox.worker_version or not (v_outbox.kind = any (v_worker.kinds)) then
      v_result.outcome := 'incompatible';
      return v_result;
    end if;
  end if;

  -- 7. The claim: the attempt starts, and its lease and fencing token are made.
  v_now := clock_timestamp();
  update jobs.attempts a set state = 'running', stage = 'started', started_at = v_now where a.id = p_attempt_id returning * into v_attempt;
  insert into jobs.leases (account_id, attempt_id, worker_id, claimed_at, renewed_at, expires_at)
    values (v_attempt.account_id, p_attempt_id, p_worker_id, v_now, v_now, v_now + make_interval(secs => jobs.lease_seconds()))
    returning * into v_lease;

  v_result.outcome := 'claimed';
  v_result.fence := v_lease.fence;
  v_result.expires_at := v_lease.expires_at;
  v_result.state := v_attempt.state;
  return v_result;
end;
$$;

comment on function api.claim_attempt(uuid, uuid, text) is
  'Claims a waiting attempt once, as the built-in step (no worker) or as a registered worker: it starts, and a 120-second lease with a fencing token is made. p_issuer is the issuer of the token that signed the claim: a registered worker named by another issuer is incompatible, before anything changes (the signed endpoint always passes it; the built-in step passes none). claimed | replayed (the same worker again, with its fence) | already_claimed | not_waiting | blocked | waiting_for_worker | incompatible | revoked (the attempt is cancelled) | unavailable. The epoch is the one bound in the outbox row.';

-- The renewal ---------------------------------------------------------------------------------------------------------------------------------

-- outcome: renewed | fence_mismatch | expired | cancelled | revoked | not_running | unavailable.
create type api.dispatch_renewal as (
  outcome text,
  attempt_id uuid,
  expires_at timestamptz,
  state text
);

create function api.renew_lease(p_attempt_id uuid, p_fence uuid)
returns api.dispatch_renewal
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_result api.dispatch_renewal;
  v_check jobs.fence_check;
  v_lease jobs.leases;
begin
  if p_attempt_id is null or p_fence is null then
    raise exception 'invalid argument' using errcode = '22023';
  end if;
  v_result.attempt_id := p_attempt_id;
  v_check := jobs.check_fence(p_attempt_id, p_fence);
  if v_check.outcome <> 'ok' then
    v_result.outcome := v_check.outcome;
    return v_result;
  end if;
  update jobs.leases l
     set renewed_at = clock_timestamp(), expires_at = clock_timestamp() + make_interval(secs => jobs.lease_seconds())
   where l.attempt_id = p_attempt_id and l.fence = p_fence and l.ended_at is null
   returning * into v_lease;
  v_result.outcome := 'renewed';
  v_result.expires_at := v_lease.expires_at;
  v_result.state := 'running';
  return v_result;
end;
$$;

comment on function api.renew_lease(uuid, uuid) is
  'Renews a live lease to 120 seconds from now. renewed | fence_mismatch | expired (an expired lease is never renewed) | cancelled | revoked (the epoch is gone: the lease is ended and the attempt cancelled) | not_running | unavailable.';

-- The step -------------------------------------------------------------------------------------------------------------------------------------

-- outcome: stepped | replayed | fence_mismatch | expired | cancelled | revoked | not_running | unavailable | not_planned.
create type api.dispatch_step as (
  outcome text,
  step_id uuid,
  operation_id uuid,
  operation_state text,
  attempt_state text
);

create function api.run_step(p_attempt_id uuid, p_fence uuid, p_step_key text, p_ordinal integer default null)
returns api.dispatch_step
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_result api.dispatch_step;
  v_check jobs.fence_check;
  v_operation jobs.operations;
  v_step jobs.steps;
  v_begin api.step_beginning;
  v_advance api.operation_advance;
begin
  if p_attempt_id is null or p_fence is null or p_step_key is null or p_step_key !~ '^[a-z][a-z0-9_]{0,39}$'
     or (p_ordinal is not null and p_ordinal not between 1 and 100) then
    raise exception 'invalid argument' using errcode = '22023';
  end if;
  v_check := jobs.check_fence(p_attempt_id, p_fence);
  if v_check.outcome <> 'ok' then
    v_result.outcome := v_check.outcome;
    return v_result;
  end if;
  v_result.attempt_state := 'running';

  if p_ordinal is null then
    -- A step with no operation: begun now, or found.
    v_begin := api.begin_step(v_check.account_id, v_check.epoch, jobs.derived_id('step', array[p_attempt_id::text, p_step_key]), p_attempt_id, p_step_key, null);
    if v_begin.outcome not in ('created', 'replayed') then
      v_result.outcome := case v_begin.outcome when 'denied' then 'revoked' when 'not_running' then 'not_running' else 'unavailable' end;
      return v_result;
    end if;
    v_result.step_id := v_begin.step_id;
    v_result.outcome := case v_begin.outcome when 'created' then 'stepped' else 'replayed' end;
  else
    -- A step with an operation: the operation must already be planned and reserved (it was, when the Job was accepted); one that is not is never made here.
    select * into v_step from jobs.steps s where s.attempt_id = p_attempt_id and s.step_key = p_step_key;
    select * into v_operation from jobs.operations o where o.step_id = v_step.id and o.ordinal = p_ordinal;
    if v_operation.id is null or not exists (select 1 from usage.reservations rv where rv.operation_id = v_operation.id) then
      v_result.outcome := 'not_planned';
      return v_result;
    end if;
    v_result.step_id := v_step.id;
    v_result.operation_id := v_operation.id;
    v_result.operation_state := v_operation.state;
    if v_operation.state = 'abandoned' then
      v_result.outcome := 'not_planned';
      return v_result;
    end if;
    v_begin := api.begin_step(v_check.account_id, v_check.epoch, jobs.derived_id('step', array[p_attempt_id::text, p_step_key, p_ordinal::text]), p_attempt_id, p_step_key, p_ordinal);
    if v_begin.outcome not in ('created', 'replayed') then
      v_result.outcome := case v_begin.outcome when 'denied' then 'revoked' when 'not_running' then 'not_running' else 'unavailable' end;
      return v_result;
    end if;
    if v_operation.state = 'planned' then
      v_advance := api.advance_operation(v_check.account_id, v_check.epoch, jobs.derived_id('dispatch', array[v_operation.id::text]), v_operation.id, 'dispatched', null);
      if v_advance.outcome not in ('advanced', 'replayed') then
        v_result.outcome := case v_advance.outcome when 'denied' then 'revoked' when 'not_running' then 'not_running' when 'unavailable' then 'unavailable' else 'not_planned' end;
        return v_result;
      end if;
      v_result.operation_state := v_advance.state;
      v_result.outcome := case v_advance.outcome when 'advanced' then 'stepped' else 'replayed' end;
    else
      v_result.outcome := 'replayed';
    end if;
  end if;

  -- The stage is where the attempt is: the step it runs now.
  update jobs.attempts a set stage = p_step_key where a.id = p_attempt_id and a.state = 'running' and a.stage <> p_step_key;
  return v_result;
end;
$$;

comment on function api.run_step(uuid, uuid, text, integer) is
  'Begins a step of a running attempt under its fence and, when the ordinal names a planned, reserved operation, dispatches it. The nested commands run under derived command IDs, so a duplicate finds its receipt. stepped | replayed | fence_mismatch | expired | cancelled | revoked | not_running | unavailable | not_planned.';

-- The operation's outcome -------------------------------------------------------------------------------------------------------------------

-- outcome: finished | fence_mismatch | expired | cancelled | revoked | not_running | unavailable | not_found | not_dispatched | invalid_transition | already_settled | invalid_evidence. The
-- amounts are those of the settlement (null when the operation holds no reservation).
create type api.dispatch_operation as (
  outcome text,
  operation_id uuid,
  state text,
  settled_microdollars bigint,
  released_microdollars bigint,
  over_microdollars bigint
);

create function api.finish_operation(
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
     or p_outcome is null or p_outcome not in ('completed', 'noncharge')
     or (p_outcome = 'completed' and (p_input_tokens is null or p_input_tokens < 0 or p_output_tokens is null or p_output_tokens < 0
                                       or p_returned_model is null or p_returned_model !~ '^[!-~]{1,200}$' or p_request_id is not null))
     or (p_outcome = 'noncharge' and (p_request_id is null or p_request_id !~ '^[!-~]{1,200}$'
                                       or p_input_tokens is not null or p_output_tokens is not null or p_returned_model is not null)) then
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
    if v_settle.outcome in ('already_settled', 'invalid_evidence') then
      raise exception using errcode = 'N3050', message = 'refused', detail = v_settle.outcome;
    end if;
    if v_settle.outcome not in ('settled', 'replayed', 'not_reserved') then
      raise exception 'api.finish_operation: the settlement was not made (%)', v_settle.outcome using errcode = '55000';
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
  'Records the outcome of a dispatched operation of the attempt under its fence: completed moves the operation and settles it as evidence (priced by the calculator, the unused remainder released), noncharge (with the provider''s request ID) moves it and settles it noncharge; an ambiguous outcome is Story 2.8''s. finished | fence_mismatch | expired | cancelled | revoked | not_running | unavailable | not_found | not_dispatched | invalid_transition | already_settled | invalid_evidence.';

-- The end of the attempt -------------------------------------------------------------------------------------------------------------------

-- outcome: finished | replayed | rejected | open_operations | fence_mismatch | expired | cancelled | revoked | not_running | unavailable. state, stage and reason are the attempt's; detail is how its
-- lease ended (for rejected: stale_revision).
create type api.dispatch_finish as (
  outcome text,
  attempt_id uuid,
  state text,
  stage text,
  reason text,
  detail text
);

create function api.finish_attempt(p_attempt_id uuid, p_fence uuid, p_to text, p_result_digest text default null, p_revision bigint default null)
returns api.dispatch_finish
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_result api.dispatch_finish;
  v_check jobs.fence_check;
  v_attempt jobs.attempts;
  v_lease jobs.leases;
  v_revision bigint;
begin
  if p_attempt_id is null or p_fence is null or p_to is null or p_to not in ('completed', 'failed')
     or (p_to = 'completed' and (p_result_digest is null or p_result_digest !~ '^[0-9a-f]{64}$'))
     or (p_to = 'failed' and p_result_digest is not null)
     or (p_revision is not null and p_revision < 1) then
    raise exception 'invalid argument' using errcode = '22023';
  end if;
  v_result.attempt_id := p_attempt_id;
  v_check := jobs.check_fence(p_attempt_id, p_fence);
  select * into v_attempt from jobs.attempts a where a.id = p_attempt_id;
  v_result.state := v_attempt.state;
  v_result.stage := v_attempt.stage;
  v_result.reason := v_attempt.reason;

  if v_check.outcome = 'not_running' and v_check.lease_end_reason is not null then
    -- The lease ended by this very finish: the same finish again is a replay and changes nothing.
    select * into v_lease from jobs.leases l where l.attempt_id = p_attempt_id and l.fence = p_fence;
    if v_lease.end_reason = p_to and v_lease.result_digest is not distinct from p_result_digest then
      v_result.outcome := 'replayed';
      v_result.detail := v_lease.detail;
      return v_result;
    end if;
  end if;
  if v_check.outcome <> 'ok' then
    v_result.outcome := v_check.outcome;
    v_result.state := v_attempt.state;
    return v_result;
  end if;

  if p_to = 'failed' then
    v_attempt := jobs.end_attempt(p_attempt_id, 'failed', 'step_failed', 'failed', 'step_failed');
    perform jobs.settle_abandoned(p_attempt_id);
    v_result.outcome := 'finished';
    v_result.detail := 'step_failed';
  else
    -- Publication needs the bound revision to be the Project's current one: a result of stale inputs never becomes current. A worker that names the revision its result was computed
    -- from (the signed `rev` claim) must name the one the attempt is bound to, or its result is as stale as one whose Project has moved on.
    select p.revision into v_revision from projects.projects p where p.id = v_check.project_id;
    if v_revision is distinct from v_check.project_revision or (p_revision is not null and p_revision <> v_check.project_revision) then
      v_attempt := jobs.end_attempt(p_attempt_id, 'failed', 'step_failed', 'revoked', 'stale_revision');
      perform jobs.settle_abandoned(p_attempt_id);
      v_result.outcome := 'rejected';
      v_result.detail := 'stale_revision';
    elsif exists (select 1 from jobs.operations o join jobs.steps s on s.id = o.step_id where s.attempt_id = p_attempt_id and o.state in ('planned', 'dispatched', 'ambiguous')) then
      v_result.outcome := 'open_operations';
      return v_result;
    else
      update jobs.leases l set ended_at = clock_timestamp(), end_reason = 'completed', detail = null, result_digest = p_result_digest
       where l.attempt_id = p_attempt_id and l.ended_at is null;
      update jobs.attempts a set state = 'completed', ended_at = clock_timestamp() where a.id = p_attempt_id returning * into v_attempt;
      v_result.outcome := 'finished';
    end if;
  end if;
  v_result.state := v_attempt.state;
  v_result.stage := v_attempt.stage;
  v_result.reason := v_attempt.reason;
  return v_result;
end;
$$;

comment on function api.finish_attempt(uuid, uuid, text, text, bigint) is
  'Ends an attempt under its fence. failed ends the lease and moves the attempt to failed/step_failed (its dispatched operations stay chargeable) and ignores p_revision. completed first rechecks the bound revision against the Project''s current one, and against p_revision when the caller names the revision its result was computed from (the signed rev claim) (a mismatch of either ends the lease revoked/stale_revision, fails the attempt step_failed and answers rejected), refuses open_operations, then ends the lease completed with the result digest. finished | replayed | rejected | open_operations | fence_mismatch | expired | cancelled | revoked | not_running | unavailable.';

-- The callbacks ---------------------------------------------------------------------------------------------------------------------------------

create type api.dispatch_callback as (outcome text);

-- Records a signed worker command, after the route has verified its token: the token's jti, issuer and key ID, its type, the command, the attempt it is about and the digest of the body. A revoked key
-- is refused (the shared lock on the key makes this and api.revoke_service_key serial, as a ticket's redemption and a heartbeat are), and a repeated jti is a duplicate.
--   recorded | duplicate | revoked
create function api.record_callback(p_jti text, p_issuer text, p_kid text, p_typ text, p_command text, p_attempt_id uuid, p_digest text)
returns api.dispatch_callback
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_result api.dispatch_callback;
  v_inserted boolean;
begin
  if p_jti is null or p_jti !~ '^[A-Za-z0-9_-]{22}$'
     or p_issuer is null or p_issuer not in ('cad-worker', 'engine-worker')
     or p_kid is null or p_kid !~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$'
     or p_typ is null or p_typ !~ '^[a-z][a-z0-9-]{0,31}$'
     or p_command is null or p_command not in ('register', 'claim', 'renew', 'step', 'operation', 'finish')
     or p_digest is null or p_digest !~ '^[0-9a-f]{64}$' then
    raise exception 'invalid argument' using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock_shared(hashtextextended('nova3d:service-key:' || p_issuer || ':' || p_kid, 0));
  if exists (select 1 from artifacts.service_key_revocations v where v.issuer = p_issuer and v.kid = p_kid) then
    v_result.outcome := 'revoked';
    return v_result;
  end if;

  insert into jobs.callbacks (jti, issuer, kid, typ, command, attempt_id, digest) values (p_jti, p_issuer, p_kid, p_typ, p_command, p_attempt_id, p_digest)
    on conflict (jti) do nothing
    returning true into v_inserted;
  v_result.outcome := case when v_inserted then 'recorded' else 'duplicate' end;
  return v_result;
end;
$$;

comment on function api.record_callback(text, text, text, text, text, uuid, text) is
  'Records an accepted signed worker command (jti, issuer, key ID, type, command, attempt, body digest). Refuses a revoked key and a repeated jti. Answers recorded | duplicate | revoked.';

-- The outbox ---------------------------------------------------------------------------------------------------------------------------------------

-- items: the rows now leased to the caller for publishing, each {id, attempt_id, job_id, kind, created_at}.
create type api.dispatch_outbox as (
  claimed integer,
  items jsonb
);

-- Leases for publishing (60 seconds) the unpublished rows older than 15 seconds whose lease is free, with FOR UPDATE SKIP LOCKED so two publishers never take the same row, or the one named row
-- at any age. A published row is never offered, and a row another publisher holds is skipped until its lease runs out.
create function api.claim_outbox(p_limit integer default 20, p_outbox_id uuid default null)
returns api.dispatch_outbox
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_result api.dispatch_outbox;
begin
  if p_limit is null or p_limit not between 1 and 100 then
    raise exception 'invalid argument' using errcode = '22023';
  end if;
  with picked as (
    select o.id
      from jobs.outbox o
     where o.published_at is null
       and (o.publish_until is null or o.publish_until <= clock_timestamp())
       and ((p_outbox_id is null and o.created_at <= clock_timestamp() - make_interval(secs => jobs.publish_grace_seconds())) or o.id = p_outbox_id)
     order by o.created_at, o.id
     limit p_limit
       for update skip locked
  ), claimed as (
    update jobs.outbox o
       set publish_until = clock_timestamp() + make_interval(secs => jobs.publish_lease_seconds())
      from picked
     where o.id = picked.id
    returning o.id, o.attempt_id, o.job_id, o.kind, o.created_at
  )
  select count(*)::integer,
         coalesce(jsonb_agg(jsonb_build_object('id', c.id, 'attempt_id', c.attempt_id, 'job_id', c.job_id, 'kind', c.kind, 'created_at', c.created_at) order by c.created_at, c.id), '[]'::jsonb)
    into v_result.claimed, v_result.items
    from claimed c;
  return v_result;
end;
$$;

comment on function api.claim_outbox(integer, uuid) is
  'Leases for publishing (60 seconds, FOR UPDATE SKIP LOCKED) the unpublished outbox rows older than 15 seconds whose lease is free, or the one named row at any age, and returns them. At most p_limit (100).';

create type api.dispatch_mark as (
  outcome text,
  message_id text
);

-- Records the message ID of a published row, once. marked | replayed (the same message ID again) | conflict (the row holds another).
create function api.mark_published(p_outbox_id uuid, p_message_id text)
returns api.dispatch_mark
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_result api.dispatch_mark;
  v_row jobs.outbox;
begin
  if p_outbox_id is null or p_message_id is null or p_message_id !~ '^[!-~]{1,200}$' then
    raise exception 'invalid argument' using errcode = '22023';
  end if;
  select * into v_row from jobs.outbox o where o.id = p_outbox_id for update;
  if not found then
    raise exception 'invalid argument' using errcode = '22023';
  end if;
  if v_row.published_at is null then
    update jobs.outbox o set published_at = clock_timestamp(), message_id = p_message_id where o.id = p_outbox_id;
    v_result.outcome := 'marked';
    v_result.message_id := p_message_id;
  else
    v_result.outcome := case when v_row.message_id = p_message_id then 'replayed' else 'conflict' end;
    v_result.message_id := v_row.message_id;
  end if;
  return v_result;
end;
$$;

comment on function api.mark_published(uuid, text) is
  'Sets published_at and message_id of an outbox row once. marked | replayed (the same message ID) | conflict (the row holds another message ID, which it returns).';

-- The sweep and the cancellation on disable ---------------------------------------------------------------------------------------------

-- Cancels the open attempts whose authority is gone, writing ONE audit event for each Account it cancelled for. Shared by the sweep (every Account) and by api.cancel_account_jobs (one
-- Account). BOTH use the same predicate: the Account is not active, or its epoch is not the one the attempt is bound to. So a canceller that runs late, after the Account was enabled
-- again, cancels exactly what the sweep would (the attempts of the old epoch) and never the healthy Jobs of the new one. The caller holds the global lock.
create function jobs.cancel_attempts(p_account_id uuid, p_limit integer) returns integer
language plpgsql
set search_path = ''
as $$
declare
  r record;
  v_cancelled integer := 0;
  v_accounts uuid[] := '{}';
  v_account uuid;
begin
  for r in
    select a.id as attempt_id, a.job_id, a.account_id
      from jobs.attempts a
      join jobs.outbox ob on ob.attempt_id = a.id
      join identity.accounts acc on acc.id = a.account_id
     where a.state in ('waiting', 'running')
       and (p_account_id is null or a.account_id = p_account_id)
       and (acc.status <> 'active' or acc.authorization_epoch <> ob.account_epoch)
     order by a.created_at, a.id
     limit p_limit
  loop
    perform pg_advisory_xact_lock(hashtextextended('nova3d:job:' || r.job_id::text, 0));
    -- Under the lock, the attempt may have ended meanwhile: it is judged again.
    if exists (select 1 from jobs.attempts a where a.id = r.attempt_id and a.state in ('waiting', 'running')) then
      perform jobs.end_attempt(r.attempt_id, 'cancelled', 'account_disabled', 'revoked', jobs.authority_detail(r.account_id));
      v_cancelled := v_cancelled + 1;
      if not r.account_id = any (v_accounts) then
        v_accounts := v_accounts || r.account_id;
      end if;
    end if;
  end loop;
  foreach v_account in array v_accounts loop
    perform identity.record_audit('system:jobs', 'jobs.cancelled', 'account:' || v_account::text);
  end loop;
  return v_cancelled;
end;
$$;

comment on function jobs.cancel_attempts(uuid, integer) is
  'Cancels, with no authority check, the open attempts of one Account (or of every Account) whose Account is not active or whose epoch is not the one the attempt is bound to: the lease revoked first, the attempt cancelled/account_disabled, the cause in the lease detail. One jobs.cancelled audit event for each Account. Callable by no API role.';

-- outcome counts: leases ended (their attempts failed/lease_lost), attempts cancelled (a disabled Account or a moved epoch) and reservations released.
create type api.dispatch_sweep as (
  expired integer,
  cancelled integer,
  settled integer
);

create function api.sweep_attempts()
returns api.dispatch_sweep
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_result api.dispatch_sweep;
  r record;
begin
  -- Two sweeps never run together: the second waits and finds nothing left to do.
  perform pg_advisory_xact_lock(hashtextextended('nova3d:jobs-sweep', 0));
  v_result.expired := 0;

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

  -- 3. What never went out is released, after every Job lock is taken.
  v_result.settled := jobs.settle_abandoned(null, null, 100);
  return v_result;
end;
$$;

comment on function api.sweep_attempts() is
  'The minute sweep''s database work: cancels the open attempts of a disabled Account or of an epoch that moved (account_disabled, lease revoked), ends every live lease past its expiry (expired) and fails its attempt as lease_lost (an attempt that is no longer running keeps its state, only its lease ends), and settles unused the abandoned operations that hold reservations. Returns the counts. Safe to run twice or at once.';

create type api.dispatch_account_cancellation as (
  cancelled integer,
  settled integer
);

create function api.cancel_account_jobs(p_account_id uuid)
returns api.dispatch_account_cancellation
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_result api.dispatch_account_cancellation;
begin
  if p_account_id is null then
    raise exception 'invalid argument' using errcode = '22023';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('nova3d:jobs-sweep', 0));
  v_result.cancelled := jobs.cancel_attempts(p_account_id, 1000);
  v_result.settled := jobs.settle_abandoned(null, p_account_id, 1000);
  return v_result;
end;
$$;

comment on function api.cancel_account_jobs(uuid) is
  'The authority-free cancellation of the open attempts of the Account whose authority is gone (the Account is not active, or the attempt''s bound epoch is not its current one: the sweep''s own predicate, so a late call never cancels the healthy Jobs of a re-enabled Account): lease revoked first, attempt cancelled/account_disabled, planned operations abandoned and released, dispatched reservations held. Writes ONE jobs.cancelled audit event (actor system:jobs, target account:<id>) when it cancelled any. Safe to run twice.';

-- The alarms ---------------------------------------------------------------------------------------------------------------------------------------

-- Two more observations: how old the oldest unpublished outbox row is, and how long ago the oldest LIVE lease (one nobody has ended) expired, among those that expired more than 300 seconds
-- ago (jobs.lease_alarm_seconds). Both are ages in seconds on the database clock, null for none.
alter type api.alarm_observation add attribute outbox_oldest bigint;
alter type api.alarm_observation add attribute lease_expired_oldest bigint;

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
  return v_result;
end;
$$;

comment on function api.alarm_observations() is
  'The ages in seconds, on the database clock, that the registry of alarm conditions needs: the first and latest receipt of any task, the first and latest heartbeat, the ledger backlog, the Auth identities with no Account, each task''s newest finished receipt, the oldest unpublished outbox row and the oldest live lease that expired more than 300 seconds ago. Read-only.';

-- The preflight -----------------------------------------------------------------------------------------------------------------------------------

-- Everything api.preflight read when 20261030120000_bind_provider_permission_to_operation.sql re-created it, plus what Story 2.7 depends on: the four new tables, the constant functions
-- and the fifteen new `api` functions (sixty-nine in all, each executable by the service role) with the internal ones behind them. It checks the catalog and executes none of them, reads at
-- most one row of each table and writes nothing. The bucket check stays last.
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
  perform oi.id, oi.account_id, oi.reservation_id, oi.settlement_id, oi.provider, oi.reserved_microdollars, oi.evidence_microdollars, oi.created_at, oi.cleared_at, oi.cleared_by from usage.overrun_incidents oi limit 1;
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
      'api.cancel_account_jobs(uuid)'
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
  'Reads identity.session_grants (including its CSRF columns), identity.accounts (including its status handle), identity.account_preferences, identity.step_up_nonces, identity.fresh_authentications (including source), identity.recovery_tokens, projects.projects, projects.project_commands, projects.request_revisions (including the review columns), projects.request_images (including the labels and measurements and the retained pins), lifecycle.tombstones, lifecycle.ledger_outbox, lifecycle.ledger_relay, lifecycle.status_requests, lifecycle.job_receipts, the six artifacts tables and the artifacts.session_authority, artifacts.instance and artifacts.retained_pictures views, lifecycle.alarms, lifecycle.alarm_notices, lifecycle.heartbeats, usage.periods, jobs.jobs, jobs.attempts, jobs.steps, jobs.operations, jobs.commands, usage.rate_schedules, usage.reservations, usage.settlements, usage.overrun_incidents, usage.commands, provider_private.permissions, jobs.outbox, jobs.workers, jobs.leases, jobs.callbacks, auth.sessions, auth.identities and auth.mfa_amr_claims (one row each at most), checks that the Story 1.5, 1.6, 1.7, 1.8, 1.9, 1.12, 1.13, 2.1, 2.2, 2.3, 2.12, 2.4, 2.11, 2.6, 2.5 and 2.7 functions exist and are executable by the service role, that the private-files bucket exists and is private, and that the owner may delete from auth.sessions and auth.users, and answers ok. Read-only.';

-- Access ------------------------------------------------------------------------------------------------------------------------------------

revoke all on all tables in schema jobs from public, anon, authenticated, service_role;
revoke all on all sequences in schema jobs from public, anon, authenticated, service_role;
revoke all on all functions in schema jobs from public, anon, authenticated, service_role;

-- Closed by default; only the service role is let in, by name. (create or replace keeps the grants api.preflight and api.alarm_observations already had.)
grant execute on function api.submit_job(uuid, bigint, uuid, uuid, text, text, jsonb, integer) to service_role;
grant execute on function api.cancel_job(uuid, bigint, uuid, uuid) to service_role;
grant execute on function api.list_jobs(uuid, bigint, integer) to service_role;
grant execute on function api.read_job_detail(uuid, bigint, uuid) to service_role;
grant execute on function api.register_worker(text, text, integer, text, text[]) to service_role;
grant execute on function api.claim_attempt(uuid, uuid, text) to service_role;
grant execute on function api.renew_lease(uuid, uuid) to service_role;
grant execute on function api.run_step(uuid, uuid, text, integer) to service_role;
grant execute on function api.finish_operation(uuid, uuid, uuid, text, bigint, bigint, text, text) to service_role;
grant execute on function api.finish_attempt(uuid, uuid, text, text, bigint) to service_role;
grant execute on function api.record_callback(text, text, text, text, text, uuid, text) to service_role;
grant execute on function api.claim_outbox(integer, uuid) to service_role;
grant execute on function api.mark_published(uuid, text) to service_role;
grant execute on function api.sweep_attempts() to service_role;
grant execute on function api.cancel_account_jobs(uuid) to service_role;

-- New functions and types: have the Data API reload its schema cache now.
notify pgrst, 'reload schema';
