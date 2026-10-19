-- Story 2.4: set accountable usage limits.
--
-- Nothing recorded what an Account may spend, and the Administrator could neither see nor change it. Paid work (Stories 2.5 to 2.8) needs a monthly limit to
-- reserve against, and changing it must need a fresh authentication and leave an accountable record. Usage owns a family of IMMUTABLE monthly periods for each
-- Account: the limit, what was carried into the period, and who started it. A limit is never edited; the Administrator changes or resets it by APPENDING a
-- successor period that carries the liabilities, and the row is itself the record of the actor, the time and the old and new limits.
--
--   usage (schema)                   new, closed like identity, projects and artifacts: row-level security on, no policy, every privilege revoked from public,
--                                    anon, authenticated and service_role, and not exposed by the Data API. Reached only through the `api` functions below.
--   usage.periods                    one row for each period of an Account: `seq` from 1, the UTC first of the month, the limit in integer USD microdollars (0 to
--                                    10,000,000,000, that is $10,000, in whole cents), what is carried in (settled and reserved), the cause (`initial`, `month`,
--                                    `change`, `reset`), the limit before, the actor (`user:<id>` or `system`), the Administrator's command ID, a digest and the
--                                    time. Update and truncate are refused by trigger; delete is left for the Epic 8 purge. The current period is the highest
--                                    `seq` of the Account.
--   usage.default_limit              $25 for a member and $50 for the Administrator.
--   identity.activate_account        re-created: it also creates the `initial` period, in the transaction that creates the Account. The migration backfills
--                                    every Account that exists.
--   usage.ensure_period              the lazy monthly rollover, internal: under the advisory lock `nova3d:usage:<account>` (the lock Story 2.6 reuses) it appends
--                                    a `month` period when the latest period is of an earlier UTC month (the same limit; settled restarts at 0; the reserved carry
--                                    is kept). Every function below calls it first. No scheduler task.
--   usage.fixture_figures            owner-written stand-in for the ledgers Story 2.6 builds; empty (so zero) in every real environment and written by no
--                                    application code and no `api` function. Story 2.6 replaces usage.period_figures and drops the table.
--   usage.period_figures             the settled and reserved figures of one period: the ONLY way they are read.
--   usage.available_microdollars     the allowance headroom of an Account, internal, for Story 2.6 (credit joins in Story 2.14).
--   api.set_usage_limit              the Administrator's command: change the limit, or reset the count. Account, command ID, expected `seq`, typed payload.
--   api.list_usage                   each Account's current period, at most 200 in the order of api.list_accounts: figures and nothing else.
--   api.record_usage_refusal         records a refused change (`usage.limit_refused`, `usage.denied`), in the pattern of api.record_account_refusal.
--   api.preflight                    re-created carrying every earlier probe and the new ones (forty-one `api` functions in all).
--
-- Money is integer microdollars: `bigint` here, a safe integer in TypeScript, never a float. Shown settled = what was carried in + the period's settled figure;
-- shown reserved likewise. Used = settled + reserved. Available = the limit less what is used, and never below 0. When a limit is lowered below what is used the
-- Account is simply at its limit (used above the limit): nothing already reserved or settled is touched.
--
-- Carry (what makes the arithmetic the same everywhere). A `change` keeps counting everything so far: carried settled = the previous carry + the previous period's
-- settled figure, carried reserved likewise. A `reset` restarts the count but keeps the liabilities: carried settled 0, carried reserved as for a change, and the
-- limit stays. So work that is already reserved keeps its reservation across both. A `month` rollover restarts the count and keeps the reserved carry.
--
-- The command (api.set_usage_limit), in this order, and nothing is appended before all of it passes:
--   1. the arguments (a shape the application would never send raises 22023);
--   2. identity.assert_operation_authority for the Administrator (a refusal answers `denied`);
--   3. the caller is an Administrator (`denied`);
--   4. the target Account exists and has no tombstone (`not_found`);
--   5. the advisory lock of the target;
--   6. the target is not disabled (`disabled`);
--   7. usage.ensure_period;
--   8. the receipt, by (target, command ID): the same digest is `replayed` (the same period), another digest is `reused`;
--   9. the latest `seq` is not the expected one (`stale`, carrying the current `seq`);
--  10. the limit is out of range, not whole cents, missing for a change or given for a reset (`invalid_limit`);
--  11. a change to the current limit is `unchanged` and appends nothing;
--  12. otherwise the successor period is appended and identity.record_audit is called in the same transaction.
--
-- The fresh administration marker is NOT checked here: it is checked in TypeScript by lib/administered.ts, the only gate (the seed command and the tests have no
-- session), and a refusal changes nothing. Refusals are recorded by api.record_usage_refusal, once an hour per actor and Account.
--
-- Same pattern as the earlier migrations: the functions in `api` run as the table owner with an empty search_path, are closed by default (the default-privileges
-- rules of 20261010120000_accounts.sql) and granted to service_role by name at the end; the functions in `usage` are callable by no API role at all.

-- The schema, closed by default -----------------------------------------------------------------------------------------------------

create schema usage;

comment on schema usage is 'Story 2.4. Usage periods (and the stand-in for the ledgers of Story 2.6). Not exposed; reached only through api functions.';

revoke all on schema usage from public, anon, authenticated, service_role;

alter default privileges for role postgres in schema usage revoke execute on functions from public, anon, authenticated, service_role;
alter default privileges for role postgres in schema usage revoke all on tables from public, anon, authenticated, service_role;
alter default privileges for role postgres in schema usage revoke all on sequences from public, anon, authenticated, service_role;

-- The periods -------------------------------------------------------------------------------------------------------------------------

create table usage.periods (
  id uuid primary key default gen_random_uuid(),
  -- RESTRICT: an Account that has periods cannot be deleted by accident; the Epic 8 purge removes them first.
  account_id uuid not null references identity.accounts (id) on delete restrict,
  seq integer not null check (seq >= 1),
  -- The first day of a UTC month.
  month_start date not null check (extract(day from month_start) = 1),
  -- Integer USD microdollars: from 0 to $10,000, in whole cents (a cent is 10,000 microdollars).
  limit_microdollars bigint not null check (limit_microdollars between 0 and 10000000000 and limit_microdollars % 10000 = 0),
  -- What was counted before this period began and still counts in it. Bounded so a figure always fits a JavaScript safe integer.
  carried_settled_microdollars bigint not null check (carried_settled_microdollars between 0 and 1000000000000000),
  carried_reserved_microdollars bigint not null check (carried_reserved_microdollars between 0 and 1000000000000000),
  cause text not null check (cause in ('initial', 'month', 'change', 'reset')),
  -- The limit of the period before this one; null only for the first.
  previous_limit_microdollars bigint check (previous_limit_microdollars between 0 and 10000000000 and previous_limit_microdollars % 10000 = 0),
  -- The Administrator who made it (`user:<Auth user ID>`) or `system` (the first period, a month's rollover).
  actor text not null check (actor = 'system' or actor ~ '^user:[A-Za-z0-9_-]{1,64}$'),
  -- The Administrator's command ID; null for a period nobody commanded.
  command_id uuid,
  -- For a command: SHA-256 of what it asked for (usage.command_digest), so a replay can be told from a reuse. For the others: of the period itself.
  digest text not null check (digest ~ '^[0-9a-f]{64}$'),
  created_at timestamptz not null default clock_timestamp(),
  constraint periods_account_seq_key unique (account_id, seq),
  constraint periods_account_command_key unique (account_id, command_id),
  -- Only the first period is `initial`, and only it has no previous limit and nothing carried.
  constraint periods_initial_shape check ((cause = 'initial') = (seq = 1) and (cause = 'initial') = (previous_limit_microdollars is null)),
  constraint periods_initial_carry check (cause <> 'initial' or (carried_settled_microdollars = 0 and carried_reserved_microdollars = 0)),
  -- A month and a reset keep the limit; a change moves it.
  constraint periods_limit_shape check (
    case cause when 'initial' then true when 'change' then limit_microdollars <> previous_limit_microdollars else limit_microdollars = previous_limit_microdollars end
  ),
  -- The count restarts at a month and at a reset.
  constraint periods_restart_shape check (cause not in ('month', 'reset') or carried_settled_microdollars = 0),
  -- A command is the Administrator's: it has a command ID and a user as its actor, and nothing else has either.
  constraint periods_command_shape check ((cause in ('change', 'reset')) = (command_id is not null) and (cause in ('change', 'reset')) = (actor <> 'system'))
);

comment on table usage.periods is
  'The immutable monthly allowance periods of Accounts (Story 2.4), one row each, never edited: the successor of a limit change or a reset is a new row that carries the liabilities, and the row is the record of the actor, the time and the old and new limits. The current period is the highest seq. Delete is left for the Epic 8 purge.';

-- A period is appended to its Account's family: the next seq, and never an earlier month than the one before it.
create function usage.check_period() returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_seq integer;
  v_month date;
begin
  select p.seq, p.month_start into v_seq, v_month from usage.periods p where p.account_id = new.account_id order by p.seq desc limit 1;
  if new.seq <> coalesce(v_seq, 0) + 1 then
    raise exception 'usage.periods: seq % is not the next period of the Account', new.seq using errcode = '23514';
  end if;
  if v_month is not null and (new.month_start < v_month or (new.cause = 'month') <> (new.month_start > v_month)) then
    raise exception 'usage.periods: a period of the same month is a change or a reset, and a month never goes back' using errcode = '23514';
  end if;
  return new;
end;
$$;

create trigger periods_check before insert on usage.periods
  for each row execute function usage.check_period();

-- A period is never edited (and never emptied in one statement). Deleting is left for the purge that removes its Account (Epic 8).
create function usage.refuse_period_change() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'usage.periods is not edited' using errcode = '55000';
end;
$$;

create trigger periods_no_update before update on usage.periods
  for each row execute function usage.refuse_period_change();
create trigger periods_no_truncate before truncate on usage.periods
  for each statement execute function usage.refuse_period_change();

-- The stand-in for the ledgers ----------------------------------------------------------------------------------------------------------

-- Written by the owner only (the tests put `nearly` and `reached` here). Empty in every real environment, and written by no application code and no
-- `api` function. Story 2.6 replaces usage.period_figures with the real ledgers and drops this table.
create table usage.fixture_figures (
  period_id uuid primary key references usage.periods (id) on delete cascade,
  settled_microdollars bigint not null default 0 check (settled_microdollars between 0 and 1000000000000000),
  reserved_microdollars bigint not null default 0 check (reserved_microdollars between 0 and 1000000000000000)
);

comment on table usage.fixture_figures is
  'Story 2.4 stand-in: the settled and reserved figures of a period until Story 2.6 builds the ledgers. Written by the owner only (tests); empty in every real environment. Story 2.6 drops it.';

-- Closed by default ----------------------------------------------------------------------------------------------------------------------

alter table usage.periods enable row level security;
alter table usage.fixture_figures enable row level security;
-- No policy: only the owner and roles that bypass RLS can read a row, and the privileges below leave anon, authenticated and service_role no path to
-- the tables at all.
revoke all on usage.periods from public, anon, authenticated, service_role;
revoke all on usage.fixture_figures from public, anon, authenticated, service_role;

-- Defaults, the month, the digests -----------------------------------------------------------------------------------------------------

-- The default limit of a new Account: $25 for an invitee, $50 for the Administrator, in microdollars.
create function usage.default_limit(p_role text) returns bigint
language plpgsql
immutable
set search_path = ''
as $$
begin
  if p_role = 'administrator' then
    return 50000000;
  elsif p_role = 'member' then
    return 25000000;
  end if;
  raise exception 'invalid argument' using errcode = '22023';
end;
$$;

comment on function usage.default_limit(text) is
  'The default monthly limit in microdollars: 25,000,000 for a member and 50,000,000 for the Administrator. Callable by no API role.';

-- The UTC first of the current month, whatever the session's time zone is.
create function usage.current_month() returns date
language sql
volatile
set search_path = ''
as $$
  select date_trunc('month', clock_timestamp() at time zone 'UTC')::date
$$;

comment on function usage.current_month() is
  'The first day of the current UTC month, from the database clock; never the session time zone. Callable by no API role.';

-- What an Administrator's command asked for: its kind, the Account, the `seq` the person saw and the limit (a dash when there is none).
create function usage.command_digest(p_kind text, p_target uuid, p_expected_seq integer, p_limit bigint) returns text
language sql
stable
set search_path = ''
as $$
  select encode(sha256(convert_to(
    'usage_limit' || E'\n' || p_kind || E'\n' || p_target::text || E'\n' || p_expected_seq::text || E'\n' || coalesce(p_limit::text, '-'), 'UTF8')), 'hex')
$$;

-- What a period nobody commanded is: its Account, place, month, limit, carry and cause.
create function usage.period_digest(p_account uuid, p_seq integer, p_month date, p_limit bigint, p_carried_settled bigint, p_carried_reserved bigint, p_cause text)
returns text
language sql
stable
set search_path = ''
as $$
  select encode(sha256(convert_to(
    'usage_period' || E'\n' || p_account::text || E'\n' || p_seq::text || E'\n' || to_char(p_month, 'YYYY-MM-DD') || E'\n' || p_limit::text || E'\n'
    || p_carried_settled::text || E'\n' || p_carried_reserved::text || E'\n' || p_cause, 'UTF8')), 'hex')
$$;

-- The one writer of periods. The caller holds the Account's advisory lock (or the Account is new).
create function usage.append_period(
  p_account uuid, p_seq integer, p_month date, p_limit bigint, p_carried_settled bigint, p_carried_reserved bigint,
  p_cause text, p_previous_limit bigint, p_actor text, p_command_id uuid, p_digest text
) returns usage.periods
language plpgsql
set search_path = ''
as $$
declare
  v_period usage.periods;
begin
  insert into usage.periods (
    account_id, seq, month_start, limit_microdollars, carried_settled_microdollars, carried_reserved_microdollars,
    cause, previous_limit_microdollars, actor, command_id, digest
  ) values (
    p_account, p_seq, p_month, p_limit, p_carried_settled, p_carried_reserved, p_cause, p_previous_limit, p_actor, p_command_id, p_digest
  ) returning * into v_period;
  return v_period;
end;
$$;

-- The first period of an Account: the default limit for its role, this UTC month, nothing carried.
create function usage.create_initial_period(p_account_id uuid, p_role text) returns usage.periods
language plpgsql
set search_path = ''
as $$
declare
  v_limit bigint := usage.default_limit(p_role);
  v_month date := usage.current_month();
begin
  return usage.append_period(
    p_account_id, 1, v_month, v_limit, 0, 0, 'initial', null, 'system', null,
    usage.period_digest(p_account_id, 1, v_month, v_limit, 0, 0, 'initial')
  );
end;
$$;

-- The figures of a period ---------------------------------------------------------------------------------------------------------

-- The settled and reserved figures OF the period (what the carried amounts are added to). This is the stand-in: it reads the owner-written fixture table, which
-- is empty, so it answers zero. Story 2.6 replaces the body with the real ledgers and drops the table; nothing else reads either.
create function usage.period_figures(p_period_id uuid)
returns table (settled_microdollars bigint, reserved_microdollars bigint)
language sql
stable
set search_path = ''
as $$
  select coalesce((select f.settled_microdollars from usage.fixture_figures f where f.period_id = p_period_id), 0)::bigint,
         coalesce((select f.reserved_microdollars from usage.fixture_figures f where f.period_id = p_period_id), 0)::bigint
$$;

comment on function usage.period_figures(uuid) is
  'The settled and reserved figures of one period, the only way they are read. Story 2.4 stand-in over usage.fixture_figures (empty, so zero); Story 2.6 replaces the body. Callable by no API role.';

-- The rollover ----------------------------------------------------------------------------------------------------------------------------

-- The Account's current period, after making sure it is of this UTC month. Rollover is lazy: nobody schedules it, and whatever reads or writes Usage calls
-- this first. When the latest period is of an earlier month, a `month` period is appended under the Account's advisory lock: the same limit, settled
-- carry 0 (the count restarts) and the reserved carry kept (what is still reserved is still owed): the previous reserved carry plus the previous period's
-- reserved figure. A second call in the same month appends nothing. An Account with no period at all (one that did not come through
-- identity.activate_account) gets its `initial` one. Without the lock when nothing needs doing, so reading 200 Accounts takes none.
create function usage.ensure_period(p_account_id uuid) returns usage.periods
language plpgsql
set search_path = ''
as $$
declare
  v_month date := usage.current_month();
  v_latest usage.periods;
  v_role text;
  v_settled bigint;
  v_reserved bigint;
begin
  if p_account_id is null then
    raise exception 'invalid argument' using errcode = '22023';
  end if;

  select * into v_latest from usage.periods p where p.account_id = p_account_id order by p.seq desc limit 1;
  if found and v_latest.month_start >= v_month then
    return v_latest;
  end if;

  -- The lock Story 2.6 reuses. Taken, and the period read again, before anything is appended.
  perform pg_advisory_xact_lock(hashtextextended('nova3d:usage:' || p_account_id::text, 0));
  select * into v_latest from usage.periods p where p.account_id = p_account_id order by p.seq desc limit 1;
  if not found then
    select a.role into v_role from identity.accounts a where a.id = p_account_id;
    if not found then
      raise exception 'usage.ensure_period: no such Account' using errcode = '22023';
    end if;
    return usage.create_initial_period(p_account_id, v_role);
  end if;
  if v_latest.month_start >= v_month then
    return v_latest;
  end if;

  select f.settled_microdollars, f.reserved_microdollars into v_settled, v_reserved from usage.period_figures(v_latest.id) f;
  return usage.append_period(
    p_account_id, v_latest.seq + 1, v_month, v_latest.limit_microdollars, 0, v_latest.carried_reserved_microdollars + v_reserved,
    'month', v_latest.limit_microdollars, 'system', null,
    usage.period_digest(p_account_id, v_latest.seq + 1, v_month, v_latest.limit_microdollars, 0, v_latest.carried_reserved_microdollars + v_reserved, 'month')
  );
end;
$$;

comment on function usage.ensure_period(uuid) is
  'The Account''s current period, after the lazy monthly rollover (a `month` period under the advisory lock nova3d:usage:<account>, same limit, settled carry 0, reserved carry kept). Callable by no API role.';

-- The allowance headroom of an Account: the limit of its current period less what is used (settled plus reserved), never below 0. For Story 2.6, which reserves
-- under the same advisory lock; credit joins in Story 2.14.
create function usage.available_microdollars(p_account_id uuid) returns bigint
language plpgsql
set search_path = ''
as $$
declare
  v_period usage.periods;
  v_settled bigint;
  v_reserved bigint;
begin
  v_period := usage.ensure_period(p_account_id);
  select f.settled_microdollars, f.reserved_microdollars into v_settled, v_reserved from usage.period_figures(v_period.id) f;
  return greatest(v_period.limit_microdollars - (v_period.carried_settled_microdollars + v_settled + v_period.carried_reserved_microdollars + v_reserved), 0);
end;
$$;

comment on function usage.available_microdollars(uuid) is
  'The allowance headroom of an Account in microdollars: the current period''s limit less settled plus reserved, never below 0. For Story 2.6 (credit joins in 2.14). Callable by no API role.';

-- Defaults for new Accounts, and the backfill ------------------------------------------------------------------------------------------

-- As 20261010120000_accounts.sql defined it, plus the `initial` period, in the transaction that creates the Account.
create or replace function identity.activate_account(p_user_id uuid, p_subject text, p_role text, p_source text) returns uuid
language plpgsql
set search_path = ''
as $$
declare
  v_account_id uuid;
begin
  insert into identity.accounts (user_id, google_subject, role, source)
    values (p_user_id, p_subject, p_role, p_source)
    returning id into v_account_id;
  perform projects.provision_workspace(v_account_id);
  perform usage.create_initial_period(v_account_id, p_role);
  return v_account_id;
end;
$$;

-- Every Account that exists gets its `initial` period (the default limit for its role, this UTC month).
-- BACKFILL BEGINS
select usage.ensure_period(a.id) from identity.accounts a order by a.created_at, a.id;
-- BACKFILL ENDS

-- The command ---------------------------------------------------------------------------------------------------------------------------

-- outcome: changed | reset | replayed | unchanged | stale | reused | invalid_limit | disabled | not_found | denied.
-- The period fields are set for changed, reset and replayed (the period the command made), and for unchanged and stale (the Account's current period).
create type api.usage_limit_change as (
  outcome text,
  period_id uuid,
  seq integer,
  month_start date,
  limit_microdollars bigint,
  previous_limit_microdollars bigint,
  cause text
);

create function api.set_usage_limit(
  p_actor text, p_admin_account_id uuid, p_epoch bigint, p_target_account_id uuid, p_command_id uuid, p_kind text, p_limit_microdollars bigint, p_expected_seq integer
) returns api.usage_limit_change
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_result api.usage_limit_change;
  v_role text;
  v_target identity.accounts;
  v_latest usage.periods;
  v_period usage.periods;
  v_digest text;
  v_settled bigint;
  v_reserved bigint;
begin
  -- 1. The arguments. A missing, negative, fractional or oversized limit is not a 22023: it is `invalid_limit`, below, so the person is told in a field message.
  if p_actor is null or p_actor !~ '^user:[A-Za-z0-9_-]{1,64}$'
     or p_admin_account_id is null or p_epoch is null or p_epoch < 1
     or p_target_account_id is null or p_command_id is null
     or p_kind is null or p_kind not in ('change', 'reset')
     or p_expected_seq is null or p_expected_seq < 1 then
    raise exception 'invalid argument' using errcode = '22023';
  end if;

  -- 2. The Administrator's authority (this takes the Administrator's row FOR SHARE until the end of the transaction).
  begin
    perform identity.assert_operation_authority(p_admin_account_id, p_epoch);
  exception when sqlstate 'N3010' then
    v_result.outcome := 'denied';
    return v_result;
  end;

  -- 3. The caller is the Administrator.
  select a.role into v_role from identity.accounts a where a.id = p_admin_account_id;
  if v_role is distinct from 'administrator' then
    v_result.outcome := 'denied';
    return v_result;
  end if;

  -- 4. The target exists and has no tombstone. Its row is held FOR SHARE, so a disable (FOR UPDATE) cannot commit between this and the write.
  select * into v_target from identity.accounts a where a.id = p_target_account_id for share;
  if not found or lifecycle.is_tombstoned('account', p_target_account_id) then
    v_result.outcome := 'not_found';
    return v_result;
  end if;

  -- 5. One command at a time for an Account: the lock Story 2.6 takes too.
  perform pg_advisory_xact_lock(hashtextextended('nova3d:usage:' || p_target_account_id::text, 0));

  -- 6. A disabled Account's limit is not changed (re-enable it first).
  if v_target.status <> 'active' then
    v_result.outcome := 'disabled';
    return v_result;
  end if;

  -- 7. The current period, of this UTC month.
  v_latest := usage.ensure_period(p_target_account_id);

  -- 8. The receipt: the period this command ID made.
  v_digest := usage.command_digest(p_kind, p_target_account_id, p_expected_seq, p_limit_microdollars);
  select * into v_period from usage.periods p where p.account_id = p_target_account_id and p.command_id = p_command_id;
  if found then
    if v_period.digest = v_digest then
      v_result.outcome := 'replayed';
      v_result.period_id := v_period.id;
      v_result.seq := v_period.seq;
      v_result.month_start := v_period.month_start;
      v_result.limit_microdollars := v_period.limit_microdollars;
      v_result.previous_limit_microdollars := v_period.previous_limit_microdollars;
      v_result.cause := v_period.cause;
    else
      v_result.outcome := 'reused';
    end if;
    return v_result;
  end if;

  -- 9. The person saw an older period than the current one.
  if v_latest.seq <> p_expected_seq then
    v_result.outcome := 'stale';
    v_result.period_id := v_latest.id;
    v_result.seq := v_latest.seq;
    v_result.month_start := v_latest.month_start;
    v_result.limit_microdollars := v_latest.limit_microdollars;
    v_result.previous_limit_microdollars := v_latest.previous_limit_microdollars;
    v_result.cause := v_latest.cause;
    return v_result;
  end if;

  -- 10. The limit: whole cents from $0 to $10,000 for a change, and none for a reset.
  if p_kind = 'reset' then
    if p_limit_microdollars is not null then
      v_result.outcome := 'invalid_limit';
      return v_result;
    end if;
  elsif p_limit_microdollars is null or p_limit_microdollars < 0 or p_limit_microdollars > 10000000000 or p_limit_microdollars % 10000 <> 0 then
    v_result.outcome := 'invalid_limit';
    return v_result;
  end if;

  -- 11. A change to the limit it already has is nothing: no period, no audit event.
  if p_kind = 'change' and p_limit_microdollars = v_latest.limit_microdollars then
    v_result.outcome := 'unchanged';
    v_result.period_id := v_latest.id;
    v_result.seq := v_latest.seq;
    v_result.month_start := v_latest.month_start;
    v_result.limit_microdollars := v_latest.limit_microdollars;
    v_result.previous_limit_microdollars := v_latest.previous_limit_microdollars;
    v_result.cause := v_latest.cause;
    return v_result;
  end if;

  -- 12. The successor carries the liabilities. A change keeps counting everything so far; a reset restarts the count but keeps what is reserved and keeps the
  -- limit. The figures of the period being closed come from the one stand-in.
  select f.settled_microdollars, f.reserved_microdollars into v_settled, v_reserved from usage.period_figures(v_latest.id) f;
  v_period := usage.append_period(
    p_target_account_id,
    v_latest.seq + 1,
    v_latest.month_start,
    case when p_kind = 'change' then p_limit_microdollars else v_latest.limit_microdollars end,
    case when p_kind = 'change' then v_latest.carried_settled_microdollars + v_settled else 0 end,
    v_latest.carried_reserved_microdollars + v_reserved,
    p_kind,
    v_latest.limit_microdollars,
    p_actor,
    p_command_id,
    v_digest
  );
  perform identity.record_audit(p_actor, case when p_kind = 'change' then 'usage.limit_changed' else 'usage.limit_reset' end, 'account:' || p_target_account_id::text);

  v_result.outcome := case when p_kind = 'change' then 'changed' else 'reset' end;
  v_result.period_id := v_period.id;
  v_result.seq := v_period.seq;
  v_result.month_start := v_period.month_start;
  v_result.limit_microdollars := v_period.limit_microdollars;
  v_result.previous_limit_microdollars := v_period.previous_limit_microdollars;
  v_result.cause := v_period.cause;
  return v_result;
end;
$$;

comment on function api.set_usage_limit(text, uuid, bigint, uuid, uuid, text, bigint, integer) is
  'The Administrator''s command: change the monthly limit of an Account, or reset its count, by appending a successor period that carries the liabilities. Account, command ID, expected seq, typed payload. changed | reset | replayed | unchanged | stale | reused | invalid_limit | disabled | not_found | denied. The fresh administration marker is checked by the application.';

-- The read ------------------------------------------------------------------------------------------------------------------------------

-- accounts: an array of objects, at most 200, in the order of api.list_accounts (newest first), each with account_id, email, role, status and the current period's
-- seq, month_start, limit_microdollars, settled_microdollars and reserved_microdollars (the shown amounts: carried + the period's figure) and cause. Nothing else.
create type api.usage_list as (outcome text, accounts jsonb);

create function api.list_usage(p_admin_account_id uuid, p_epoch bigint) returns api.usage_list
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_result api.usage_list;
  v_role text;
  v_account uuid;
begin
  if p_admin_account_id is null or p_epoch is null or p_epoch < 1 then
    raise exception 'invalid argument' using errcode = '22023';
  end if;

  begin
    perform identity.assert_operation_authority(p_admin_account_id, p_epoch);
  exception when sqlstate 'N3010' then
    v_result.outcome := 'denied';
    return v_result;
  end;
  select a.role into v_role from identity.accounts a where a.id = p_admin_account_id;
  if v_role is distinct from 'administrator' then
    v_result.outcome := 'denied';
    return v_result;
  end if;

  -- The month is rolled over for each Account the list shows, before it is read.
  for v_account in select a.id from identity.accounts a order by a.created_at desc, a.id limit 200 loop
    perform usage.ensure_period(v_account);
  end loop;

  select coalesce(jsonb_agg(
           jsonb_build_object(
             'account_id', r.id, 'email', r.verified_email, 'role', r.role, 'status', r.status,
             'seq', r.seq, 'month_start', r.month_start, 'limit_microdollars', r.limit_microdollars,
             'settled_microdollars', r.settled, 'reserved_microdollars', r.reserved, 'cause', r.cause
           ) order by r.created_at desc, r.id),
         '[]'::jsonb)
    into v_result.accounts
    from (
      select a.id, a.created_at, a.role, a.status, g.verified_email,
             p.seq, p.month_start, p.limit_microdollars, p.cause,
             p.carried_settled_microdollars + f.settled_microdollars as settled,
             p.carried_reserved_microdollars + f.reserved_microdollars as reserved
        from identity.accounts a
        left join lateral identity.verified_google(a.user_id) g on true
        join lateral (select q.* from usage.periods q where q.account_id = a.id order by q.seq desc limit 1) p on true
        cross join lateral usage.period_figures(p.id) f
       order by a.created_at desc, a.id
       limit 200
    ) r;

  v_result.outcome := 'listed';
  return v_result;
end;
$$;

comment on function api.list_usage(uuid, bigint) is
  'The current period of each Account (at most 200, in the order of api.list_accounts): ID, verified address, role, status, seq, month, limit, shown settled, shown reserved and cause. Rolls the month over first. Nothing else. listed | denied (unless an active Administrator).';

-- Refused attempts ----------------------------------------------------------------------------------------------------------------------

-- The check that decides a refusal is made by the application, in the Server Action, before it calls api.set_usage_limit; this only records what the application
-- decided, and checks the one thing it can: that the actor is a real Account, and that the refusal is the kind that Account can make (only an Administrator is
-- "refused for want of a marker", and only an Account that is not an Administrator is "denied"). What is recorded is who (user:<Auth user ID>), what (one of the
-- two actions), which Account (account:<ID>, only if it exists) and when. Never a reason, a limit, an amount or any content. At most once an hour per actor,
-- action and target, under an advisory lock.
--   recorded | repeated (the same refusal was already recorded in the last hour; nothing was written)
create type api.usage_refusal as (outcome text);

create function api.record_usage_refusal(p_user_id uuid, p_action text, p_target_account_id uuid default null)
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
  if p_user_id is null or p_action is null or p_action not in ('usage.limit_refused', 'usage.denied') then
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
  'Records a refused usage-limit change (usage.limit_refused or usage.denied) for an Account: the actor and the Account as target when it exists. At most once an hour per actor, action and target. Never content. recorded | repeated.';

-- The preflight -----------------------------------------------------------------------------------------------------------------------------------

-- Everything api.preflight read before (20261021120000_retained_pictures.sql), plus what this story depends on: the two tables of the closed usage schema, the
-- three new `api` functions (forty-one in all, each executable by the service role) and the four internal ones the rollover and Story 2.6 use. It checks the
-- catalog and executes none of them, reads at most one row of each table and writes nothing. The bucket check stays last.
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
      'api.record_usage_refusal(uuid,text,uuid)'
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
  'Reads identity.session_grants (including its CSRF columns), identity.accounts (including its status handle), identity.account_preferences, identity.step_up_nonces, identity.fresh_authentications (including source), identity.recovery_tokens, projects.projects, projects.project_commands, projects.request_revisions (including the review columns), projects.request_images (including the labels and measurements and the retained pins), lifecycle.tombstones, lifecycle.ledger_outbox, lifecycle.ledger_relay, lifecycle.status_requests, lifecycle.job_receipts, the six artifacts tables and the artifacts.session_authority, artifacts.instance and artifacts.retained_pictures views, lifecycle.alarms, lifecycle.alarm_notices, lifecycle.heartbeats, usage.periods, usage.fixture_figures, auth.sessions, auth.identities and auth.mfa_amr_claims (one row each at most), checks that the Story 1.5, 1.6, 1.7, 1.8, 1.9, 1.12, 1.13, 2.1, 2.2, 2.3, 2.12 and 2.4 functions exist and are executable by the service role, that the private-files bucket exists and is private, and that the owner may delete from auth.sessions and auth.users, and answers ok. Read-only.';

-- Access ------------------------------------------------------------------------------------------------------------------------------------

revoke all on all tables in schema usage from public, anon, authenticated, service_role;
revoke all on all sequences in schema usage from public, anon, authenticated, service_role;
revoke all on all functions in schema usage from public, anon, authenticated, service_role;

-- Closed by default; only the service role is let in, by name. (create or replace keeps the grants api.preflight already had; identity.activate_account is
-- granted to nobody, as before.)
grant execute on function api.set_usage_limit(text, uuid, bigint, uuid, uuid, text, bigint, integer) to service_role;
grant execute on function api.list_usage(uuid, bigint) to service_role;
grant execute on function api.record_usage_refusal(uuid, text, uuid) to service_role;

-- New functions and types: have the Data API reload its schema cache now.
notify pgrst, 'reload schema';
