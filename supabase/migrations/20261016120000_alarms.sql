-- Story 1.13: operational alarms. The records, the seven functions the application calls, and the preflight.
--
-- Nothing told the Administrator when something stopped. This file is the database half of the alarm path: an alarm record per condition (and
-- optional subject) that is open until the condition clears, the notices that say whether an alarm was emailed, the heartbeats the Railway cron task
-- posts, and the one function that reports every age in SECONDS, so the application never compares its own clock with the database's. The conditions
-- themselves (lib/alarm-conditions.ts), the monitor (lib/alarms.ts) and the email (lib/mailer.ts `sendAlarmMail`) are TypeScript; every time here
-- comes from the database clock (clock_timestamp()).
--
--   lifecycle.alarms          one row per incident: condition, optional subject, first and latest time, resolved time and a small flat `detail`.
--                             A partial unique index allows ONE open alarm (resolved_at is null) per (condition, subject). Never deleted or truncated;
--                             `id`, `condition`, `subject` and `first_at` never change, `latest_at` never decreases, `resolved_at` is set once (and a
--                             resolved alarm is final).
--   lifecycle.alarm_notices   append-only: one row per attempt to email an alarm, with its outcome `sent`, `failed` or `unknown`.
--   lifecycle.heartbeats      append-only: one row per accepted heartbeat of the Railway cron task: the token's `jti` (unique, so a replay is
--                             refused), the key ID and the time received.
--   api.raise_alarm           opens an alarm, or refreshes the open one for the same (condition, subject): `opened` | `refreshed`, with the ID.
--   api.resolve_alarm         resolves the open alarm of a (condition, subject): `resolved` | `none`.
--   api.list_alarms           the open alarms, newest first, and, on request, the most recently resolved ones, each with its email state.
--   api.alarms_due_mail       the open alarms that are due an email (the whole rule is here, see below).
--   api.record_alarm_notice   records the outcome of one attempt to email an alarm.
--   api.alarm_observations    every number the registry of conditions needs, as ages in seconds; the one place the Auth identities are counted.
--   api.record_heartbeat      records a heartbeat; refuses a revoked key and a repeated `jti`.
--   api.preflight             re-created carrying every earlier probe plus the new tables and functions.
--   job_receipts_started      ONE INDEX ON AN EXISTING TABLE, Story 1.9's `lifecycle.job_receipts` (on `started_at`): the first and the latest receipt of any
--                             task are read by the monitor every five minutes and by every heartbeat, from a table that is never pruned, and this makes them an
--                             index read and not a scan of every receipt there ever was. It adds no row, column, trigger or privilege and changes nothing about
--                             how a receipt is written or read: the table's contract (Story 1.9) is as it was.
--
-- THE EMAIL RULE (all in api.alarms_due_mail). An open alarm is due when it has had no `sent` notice in the last 24 hours and, for an alarm with no
-- subject (a threshold alarm), no `sent` notice for ANY alarm of the same condition in the last 24 hours. So an alarm is emailed when it opens (a
-- subject-keyed one at the evaluation that raised it; a threshold one unless its condition was emailed within 24 hours, in which case when that window
-- ends, if it is still open) and reminded at most once every 24 hours while it stays open. A `failed` or `unknown` notice never closes a window, so the
-- email is retried at the next evaluation (an `unknown` may duplicate one mail: accepted). A resolved alarm is never emailed.
--
-- Like the Story 1.8 and 1.9 tables, each table is closed explicitly (row-level security on, no policy, every privilege revoked from public, anon,
-- authenticated and service_role), because the `lifecycle` schema is one the Data API lists. They are reached only through the `api` functions, which
-- run as the owner with an empty search_path and are executable by the service role alone.

-- What an alarm's detail may hold ----------------------------------------------------------------------------------------------------------

-- A flat object of at most 1 KB whose keys are lower-case words and whose values are integers, booleans, or strings of at most 80 printable ASCII
-- characters (a task's name, an outcome, a time). Nothing else fits: no nested value, no number with a fraction, no long text, no non-ASCII text.
create function lifecycle.alarm_detail_ok(p_detail json) returns boolean
language sql
immutable
set search_path = ''
as $$
  select p_detail is not null
     and json_typeof(p_detail) = 'object'
     and octet_length(p_detail::text) <= 1024
     and not exists (
       select 1
         from json_each(p_detail) e
        where e.key !~ '^[a-z][a-z0-9_]{0,31}$'
           or not (
             (json_typeof(e.value) = 'number' and e.value::text ~ '^-?(0|[1-9][0-9]{0,14})$')
             or json_typeof(e.value) = 'boolean'
             or (json_typeof(e.value) = 'string' and (e.value #>> '{}') ~ '^[ -~]{0,80}$')
           )
     )
     and not exists (select 1 from json_each(p_detail) e group by e.key having count(*) > 1)
$$;

comment on function lifecycle.alarm_detail_ok(json) is
  'Whether an alarm''s detail is a flat object of at most 1 KB with lower-case word keys and integer, boolean or short printable-ASCII string values. Callable by no API role.';

-- A time as the application reads it: UTC, to the millisecond, the same text the ledger events carry.
create function lifecycle.iso_utc(p_at timestamptz) returns text
language sql
immutable
strict
set search_path = ''
as $$
  select to_char(p_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
$$;

comment on function lifecycle.iso_utc(timestamptz) is 'A time as UTC text to the millisecond. Callable by no API role.';

-- How old a time is on the DATABASE clock, in whole seconds (never negative); null for no time.
create function lifecycle.age_seconds(p_at timestamptz) returns bigint
language sql
volatile
set search_path = ''
as $$
  select case when p_at is null then null else greatest(floor(extract(epoch from clock_timestamp() - p_at)), 0)::bigint end
$$;

comment on function lifecycle.age_seconds(timestamptz) is 'The age of a time in whole seconds on the database clock, null for no time. Callable by no API role.';

-- Alarms -----------------------------------------------------------------------------------------------------------------------------------

create table lifecycle.alarms (
  id uuid primary key default gen_random_uuid(),
  condition text not null check (condition ~ '^[a-z][a-z0-9-]{0,47}$'),
  subject text check (subject is null or subject ~ '^[A-Za-z0-9._:-]{1,64}$'),
  first_at timestamptz not null default clock_timestamp(),
  latest_at timestamptz not null default clock_timestamp(),
  resolved_at timestamptz,
  detail json not null check (lifecycle.alarm_detail_ok(detail)),
  check (latest_at >= first_at),
  check (resolved_at is null or resolved_at >= latest_at)
);

comment on table lifecycle.alarms is
  'One row per operational incident: condition, optional subject, first and latest time, resolved time and a small flat detail. One open alarm for each (condition, subject). Never deleted or truncated. Written only by api.raise_alarm and api.resolve_alarm.';

-- One open alarm for each (condition, subject); a null subject is one subject of its own (a real subject is never empty).
create unique index alarms_one_open on lifecycle.alarms (condition, (coalesce(subject, ''))) where resolved_at is null;
create index alarms_open_listing on lifecycle.alarms (first_at desc, id) where resolved_at is null;
create index alarms_resolved_listing on lifecycle.alarms (resolved_at desc, id) where resolved_at is not null;

-- What an alarm is can never change; while it is open only its latest time (never back) and its detail move, and it is resolved once. A resolved alarm
-- is final: the next crossing is a new alarm.
create function lifecycle.guard_alarm() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.id <> old.id or new.condition <> old.condition or new.subject is distinct from old.subject or new.first_at <> old.first_at then
    raise exception 'an alarm is immutable apart from its latest time, its detail and being resolved' using errcode = '55000';
  end if;
  if old.resolved_at is not null then
    raise exception 'a resolved alarm is final' using errcode = '55000';
  end if;
  if new.latest_at < old.latest_at then
    raise exception 'an alarm''s latest time never decreases' using errcode = '55000';
  end if;
  return new;
end;
$$;

create trigger alarms_guard before update on lifecycle.alarms
  for each row execute function lifecycle.guard_alarm();
create trigger alarms_no_delete before delete on lifecycle.alarms
  for each row execute function lifecycle.refuse_change();
create trigger alarms_no_truncate before truncate on lifecycle.alarms
  for each statement execute function lifecycle.refuse_change();

-- Notices ----------------------------------------------------------------------------------------------------------------------------------

create table lifecycle.alarm_notices (
  id uuid primary key default gen_random_uuid(),
  alarm_id uuid not null references lifecycle.alarms (id) on delete restrict,
  at timestamptz not null default clock_timestamp(),
  outcome text not null check (outcome in ('sent', 'failed', 'unknown'))
);

comment on table lifecycle.alarm_notices is
  'One row per attempt to email an alarm: the alarm, the time and the outcome (sent, failed, unknown). Never updated, deleted or truncated. Written only by api.record_alarm_notice.';

-- The 24-hour windows look at the `sent` notices only.
create index alarm_notices_sent_by_alarm on lifecycle.alarm_notices (alarm_id, at desc) where outcome = 'sent';
create index alarm_notices_by_alarm on lifecycle.alarm_notices (alarm_id, at desc, id desc);
create index alarm_notices_sent_by_time on lifecycle.alarm_notices (at desc) where outcome = 'sent';

create trigger alarm_notices_no_change before update or delete on lifecycle.alarm_notices
  for each row execute function lifecycle.refuse_change();
create trigger alarm_notices_no_truncate before truncate on lifecycle.alarm_notices
  for each statement execute function lifecycle.refuse_change();

-- Heartbeats -------------------------------------------------------------------------------------------------------------------------------

create table lifecycle.heartbeats (
  id uuid primary key default gen_random_uuid(),
  -- The token's `jti` (128 random bits, base64url): unique, so a token is accepted once.
  jti text not null unique check (jti ~ '^[A-Za-z0-9_-]{22}$'),
  kid text not null check (kid ~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$'),
  received_at timestamptz not null default clock_timestamp()
);

comment on table lifecycle.heartbeats is
  'One row per accepted heartbeat of the Railway cron task: the token''s jti (unique), the key ID and the time received. Never updated, deleted or truncated. Written only by api.record_heartbeat.';

create index heartbeats_received on lifecycle.heartbeats (received_at desc);

create trigger heartbeats_no_change before update or delete on lifecycle.heartbeats
  for each row execute function lifecycle.refuse_change();
create trigger heartbeats_no_truncate before truncate on lifecycle.heartbeats
  for each statement execute function lifecycle.refuse_change();

-- Closed by default, like every table of this schema ------------------------------------------------------------------------------------------

alter table lifecycle.alarms enable row level security;
alter table lifecycle.alarm_notices enable row level security;
alter table lifecycle.heartbeats enable row level security;
-- No policy: only the owner and roles that bypass RLS can read a row, and the privileges below leave anon, authenticated and service_role no path to
-- the tables at all.
revoke all on lifecycle.alarms from public, anon, authenticated, service_role;
revoke all on lifecycle.alarm_notices from public, anon, authenticated, service_role;
revoke all on lifecycle.heartbeats from public, anon, authenticated, service_role;
revoke all on all functions in schema lifecycle from public, anon, authenticated, service_role;

-- Raising and resolving ----------------------------------------------------------------------------------------------------------------------

create type api.alarm_raised as (outcome text, alarm_id uuid);

-- Opens an alarm for a (condition, subject) or, when one is open for that pair, refreshes its latest time and detail. Serialized per pair by a
-- transaction-level advisory lock, so two evaluations at once leave one alarm and the second sees what the first committed.
--   opened | refreshed     with the alarm's ID
create function api.raise_alarm(p_condition text, p_subject text, p_detail json)
returns api.alarm_raised
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_result api.alarm_raised;
  v_id uuid;
  v_now timestamptz;
begin
  if p_condition is null or p_condition !~ '^[a-z][a-z0-9-]{0,47}$'
     or (p_subject is not null and p_subject !~ '^[A-Za-z0-9._:-]{1,64}$')
     or not lifecycle.alarm_detail_ok(p_detail) then
    raise exception 'invalid argument' using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('nova3d:alarm:' || p_condition || ':' || coalesce(p_subject, ''), 0));
  v_now := clock_timestamp();

  -- Read after the lock is held: an alarm another evaluation opened or resolved while this waited is seen.
  select a.id into v_id
    from lifecycle.alarms a
   where a.condition = p_condition and a.subject is not distinct from p_subject and a.resolved_at is null
     for update;
  if found then
    update lifecycle.alarms a set latest_at = greatest(a.latest_at, v_now), detail = p_detail where a.id = v_id;
    v_result.outcome := 'refreshed';
  else
    insert into lifecycle.alarms (condition, subject, first_at, latest_at, detail)
      values (p_condition, p_subject, v_now, v_now, p_detail)
      returning id into v_id;
    v_result.outcome := 'opened';
  end if;
  v_result.alarm_id := v_id;
  return v_result;
end;
$$;

comment on function api.raise_alarm(text, text, json) is
  'Opens an alarm for a (condition, subject) or refreshes the open one''s latest time and detail, under an advisory lock per pair. Answers opened | refreshed with the alarm''s ID.';

create type api.alarm_resolved as (outcome text, alarm_id uuid);

-- Resolves the open alarm of a (condition, subject), once, under the same lock. The record is kept.
--   resolved | none     (none: no alarm was open for the pair)
create function api.resolve_alarm(p_condition text, p_subject text)
returns api.alarm_resolved
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_result api.alarm_resolved;
  v_id uuid;
begin
  if p_condition is null or p_condition !~ '^[a-z][a-z0-9-]{0,47}$'
     or (p_subject is not null and p_subject !~ '^[A-Za-z0-9._:-]{1,64}$') then
    raise exception 'invalid argument' using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('nova3d:alarm:' || p_condition || ':' || coalesce(p_subject, ''), 0));

  update lifecycle.alarms a
     set resolved_at = greatest(a.latest_at, clock_timestamp())
   where a.condition = p_condition and a.subject is not distinct from p_subject and a.resolved_at is null
  returning a.id into v_id;
  if found then
    v_result.outcome := 'resolved';
    v_result.alarm_id := v_id;
  else
    v_result.outcome := 'none';
  end if;
  return v_result;
end;
$$;

comment on function api.resolve_alarm(text, text) is
  'Resolves the open alarm of a (condition, subject) once, under the advisory lock of the pair. The record is kept. Answers resolved | none.';

-- Listing --------------------------------------------------------------------------------------------------------------------------------------

create type api.alarm_list as (alarms json);

-- The open alarms, newest first (at most 500: the registry is small, so this is a defensive cap), and, when p_include_resolved is true, the
-- p_limit (1 to 50) most recently resolved ones after them. Each alarm carries the time of its last `sent` notice and the outcome and time of its
-- latest notice of any kind, from which the page reads its email state (sent at, pending or failing). Times are UTC text to the millisecond. Read-only.
create function api.list_alarms(p_include_resolved boolean, p_limit integer)
returns api.alarm_list
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_result api.alarm_list;
begin
  if p_include_resolved is null or p_limit is null or p_limit not between 1 and 50 then
    raise exception 'invalid argument' using errcode = '22023';
  end if;

  select coalesce(json_agg(
           json_build_object(
             'id', s.id,
             'condition', s.condition,
             'subject', s.subject,
             'first_at', lifecycle.iso_utc(s.first_at),
             'latest_at', lifecycle.iso_utc(s.latest_at),
             'resolved_at', lifecycle.iso_utc(s.resolved_at),
             'detail', s.detail,
             'last_sent_at', (select lifecycle.iso_utc(max(n.at)) from lifecycle.alarm_notices n where n.alarm_id = s.id and n.outcome = 'sent'),
             'last_notice_outcome', (select n.outcome from lifecycle.alarm_notices n where n.alarm_id = s.id order by n.at desc, n.id desc limit 1),
             'last_notice_at', (select lifecycle.iso_utc(n.at) from lifecycle.alarm_notices n where n.alarm_id = s.id order by n.at desc, n.id desc limit 1)
           )
           order by s.grp, s.sort_at desc, s.id
         ), '[]'::json)
    into v_result.alarms
    from (
      (select o.*, 0 as grp, o.first_at as sort_at
         from lifecycle.alarms o
        where o.resolved_at is null
        order by o.first_at desc, o.id
        limit 500)
      union all
      (select r.*, 1 as grp, r.resolved_at as sort_at
         from lifecycle.alarms r
        where p_include_resolved and r.resolved_at is not null
        order by r.resolved_at desc, r.id
        limit p_limit)
    ) s;
  return v_result;
end;
$$;

comment on function api.list_alarms(boolean, integer) is
  'The open alarms, newest first, and when asked the p_limit (1 to 50) most recently resolved after them, each with its last sent notice and its latest notice. Read-only.';

-- Mail ----------------------------------------------------------------------------------------------------------------------------------------

create type api.alarms_due as (alarms json);

-- The open alarms that are due an email, oldest first, at most p_limit (1 to 50), as [{id, condition, subject, first_at, detail}]. The rule, whole:
-- an open alarm is due when it has had no `sent` notice in the last 24 hours and, when it has no subject, no `sent` notice for any alarm of the same
-- condition in the last 24 hours. A `failed` or `unknown` notice closes nothing. Read-only.
create function api.alarms_due_mail(p_limit integer)
returns api.alarms_due
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  c_window constant interval := interval '24 hours';
  v_result api.alarms_due;
  v_now timestamptz := clock_timestamp();
begin
  if p_limit is null or p_limit not between 1 and 50 then
    raise exception 'invalid argument' using errcode = '22023';
  end if;

  select coalesce(json_agg(
           json_build_object(
             'id', d.id,
             'condition', d.condition,
             'subject', d.subject,
             'first_at', lifecycle.iso_utc(d.first_at),
             'detail', d.detail
           )
           order by d.first_at, d.id
         ), '[]'::json)
    into v_result.alarms
    from (
      select a.id, a.condition, a.subject, a.first_at, a.detail
        from lifecycle.alarms a
       where a.resolved_at is null
         and not exists (
           select 1 from lifecycle.alarm_notices n
            where n.alarm_id = a.id and n.outcome = 'sent' and n.at > v_now - c_window)
         and (a.subject is not null or not exists (
           select 1
             from lifecycle.alarm_notices n
             join lifecycle.alarms b on b.id = n.alarm_id
            where b.condition = a.condition and n.outcome = 'sent' and n.at > v_now - c_window))
       order by a.first_at, a.id
       limit p_limit
    ) d;
  return v_result;
end;
$$;

comment on function api.alarms_due_mail(integer) is
  'The open alarms due an email: no sent notice in the last 24 hours and, with no subject, none for any alarm of the same condition in the last 24 hours. A failed or unknown notice closes nothing. Read-only.';

create type api.alarm_notice_receipt as (outcome text);

-- Records one attempt to email an alarm. `sent` closes the 24-hour windows; `failed` and `unknown` close nothing.
--   recorded | not_found
create function api.record_alarm_notice(p_alarm_id uuid, p_outcome text)
returns api.alarm_notice_receipt
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_result api.alarm_notice_receipt;
begin
  if p_alarm_id is null or p_outcome is null or p_outcome not in ('sent', 'failed', 'unknown') then
    raise exception 'invalid argument' using errcode = '22023';
  end if;
  if not exists (select 1 from lifecycle.alarms a where a.id = p_alarm_id) then
    v_result.outcome := 'not_found';
    return v_result;
  end if;
  insert into lifecycle.alarm_notices (alarm_id, outcome) values (p_alarm_id, p_outcome);
  v_result.outcome := 'recorded';
  return v_result;
end;
$$;

comment on function api.record_alarm_notice(uuid, text) is
  'Records one attempt to email an alarm (sent, failed, unknown). Only sent closes a 24-hour window. Answers recorded | not_found.';

-- Observations ---------------------------------------------------------------------------------------------------------------------------------

-- The first and the latest receipt of any task are read by the monitor every five minutes and by every heartbeat, from a table that is never pruned: the
-- minimum and the maximum of the start time come from this index, not from a scan of every receipt there ever was. (It changes nothing about the table.)
create index job_receipts_started on lifecycle.job_receipts (started_at);

-- Everything the registry of conditions (lib/alarm-conditions.ts) looks at, as AGES IN SECONDS on the database clock, so the application never
-- compares its own clock with the database's:
--   first_receipt_age        the age of the first receipt of any task (null: no task has ever been claimed)
--   latest_receipt_age       the age of the latest receipt of any task, finished or not (null: none)
--   first_heartbeat_age      the age of the first heartbeat (null: none)
--   latest_heartbeat_age     the age of the latest heartbeat (null: none)
--   ledger_pending           how many ledger events wait for the relay
--   ledger_oldest            the age of the oldest of them (null: none pending)
--   unaccounted              how many Auth identities have no Account (the predicate of the dormant-identity purge, without its age): the ONE place the
--                            application counts them, so it never names auth.users
--   tasks                    for each task that has finished a run, its newest finished receipt: [{task, outcome, at, age}]
create type api.alarm_observation as (
  first_receipt_age bigint,
  latest_receipt_age bigint,
  first_heartbeat_age bigint,
  latest_heartbeat_age bigint,
  ledger_pending integer,
  ledger_oldest bigint,
  unaccounted integer,
  tasks json
);

create function api.alarm_observations()
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
  return v_result;
end;
$$;

comment on function api.alarm_observations() is
  'The ages in seconds, on the database clock, that the registry of alarm conditions needs: the first and latest receipt of any task, the first and latest heartbeat, the ledger backlog, the Auth identities with no Account, and each task''s newest finished receipt. Read-only.';

-- Heartbeats ------------------------------------------------------------------------------------------------------------------------------------

create type api.heartbeat_receipt as (outcome text);

-- Records a heartbeat of the Railway cron task: the key ID and the token's `jti`, both already verified by the route. A revoked key is refused (the
-- shared lock on the key makes this and api.revoke_service_key serial, as a ticket's redemption is), and a repeated `jti` is a duplicate.
--   recorded | duplicate | revoked
create function api.record_heartbeat(p_kid text, p_jti text)
returns api.heartbeat_receipt
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_result api.heartbeat_receipt;
  v_inserted boolean;
begin
  if p_kid is null or p_kid !~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$' or p_jti is null or p_jti !~ '^[A-Za-z0-9_-]{22}$' then
    raise exception 'invalid argument' using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock_shared(hashtextextended('nova3d:service-key:heartbeat:' || p_kid, 0));
  if exists (select 1 from artifacts.service_key_revocations v where v.issuer = 'heartbeat' and v.kid = p_kid) then
    v_result.outcome := 'revoked';
    return v_result;
  end if;

  insert into lifecycle.heartbeats (jti, kid) values (p_jti, p_kid)
    on conflict (jti) do nothing
    returning true into v_inserted;
  v_result.outcome := case when v_inserted then 'recorded' else 'duplicate' end;
  return v_result;
end;
$$;

comment on function api.record_heartbeat(text, text) is
  'Records a heartbeat (key ID and the token''s jti). Refuses a revoked heartbeat key and a repeated jti. Answers recorded | duplicate | revoked.';

-- The preflight -------------------------------------------------------------------------------------------------------------------------------

-- Everything api.preflight read before (20261015120000_file_gateway.sql), plus what this story depends on: the three alarm tables (with the columns
-- the functions use), the seven functions of this story (and lifecycle.alarm_detail_ok), and the service role can execute the seven `api` ones (thirty-one
-- `api` functions in all). It checks the catalog and executes none of them, reads at most one row of each table and writes nothing. (The Auth identities
-- are counted by api.alarm_observations, not here: the preflight reads no row of auth.users.)
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
  perform l.id, l.account_id, l.kid, l.kind, l.length, l.sha256, l.content_type, l.received_length, l.state, l.created_at, l.expires_at from artifacts.staging_leases l limit 1;
  perform d.jti, d.typ, d.issuer, d.kid, d.account_id, d.session_id, d.direction, d.target_kind, d.target_id, d.expires_at, d.redeemed_at from artifacts.ticket_redemptions d limit 1;
  perform h.hash, h.jti, h.session_id, h.account_id, h.epoch, h.direction, h.target_kind, h.target_id, h.kid, h.created_at, h.expires_at, h.ended_at from artifacts.transfer_handles h limit 1;
  perform f.root, f.id, f.account_id, f.upload_id, f.kind, f.digest, f.length, f.serialization, f.activity, f.body, f.created_at from artifacts.manifests f limit 1;
  perform x.name, x.registered_at from artifacts.attachment_transforms x limit 1;
  perform v.issuer, v.kid, v.reason, v.revoked_at from artifacts.service_key_revocations v limit 1;
  perform w.session_id, w.account_id, w.epoch, w.state from artifacts.session_authority w limit 1;
  perform n.environment, n.instance_id from artifacts.instance n limit 1;
  perform k.id, k.condition, k.subject, k.first_at, k.latest_at, k.resolved_at, k.detail from lifecycle.alarms k limit 1;
  perform e.id, e.alarm_id, e.at, e.outcome from lifecycle.alarm_notices e limit 1;
  perform z.id, z.jti, z.kid, z.received_at from lifecycle.heartbeats z limit 1;
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
      'api.record_heartbeat(text,text)'
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
  'Reads identity.session_grants (including its CSRF columns), identity.accounts (including its status handle), identity.account_preferences, identity.step_up_nonces, identity.fresh_authentications (including source), identity.recovery_tokens, projects.projects, projects.project_commands, lifecycle.tombstones, lifecycle.ledger_outbox, lifecycle.ledger_relay, lifecycle.status_requests, lifecycle.job_receipts, the six artifacts tables and the artifacts.session_authority and artifacts.instance views, lifecycle.alarms, lifecycle.alarm_notices, lifecycle.heartbeats, auth.sessions, auth.identities and auth.mfa_amr_claims (one row each at most), checks that the Story 1.5, 1.6, 1.7, 1.8, 1.9, 1.12 and 1.13 functions exist and are executable by the service role, that the private-files bucket exists and is private, and that the owner may delete from auth.sessions and auth.users, and answers ok. Read-only.';

-- Access --------------------------------------------------------------------------------------------------------------------------------------

-- Closed by default; only the service role is let in, by name. lifecycle.* helpers are granted to nobody: SQL that runs as the owner calls them.
-- (create or replace keeps the grants api.preflight already had.)
grant execute on function api.raise_alarm(text, text, json) to service_role;
grant execute on function api.resolve_alarm(text, text) to service_role;
grant execute on function api.list_alarms(boolean, integer) to service_role;
grant execute on function api.alarms_due_mail(integer) to service_role;
grant execute on function api.record_alarm_notice(uuid, text) to service_role;
grant execute on function api.alarm_observations() to service_role;
grant execute on function api.record_heartbeat(text, text) to service_role;

-- New functions and types: have the Data API reload its schema cache now.
notify pgrst, 'reload schema';
