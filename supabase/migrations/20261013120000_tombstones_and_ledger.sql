-- Story 1.8: tombstones and the hidden-state contract.
--
-- Lifecycle owns what makes a deleted Account or Project unreachable for every later feature at once, and what remembers
-- a deletion, a disable, a consumed invitation or a recovery outside the rows a restore could roll back. Nothing in the
-- application creates a tombstone yet: Epic 8's deletion commands will, through the one writer this file provides.
--
--   lifecycle.tombstones      one row per deleted target: its kind (`account` or `project`), target ID, status handle,
--                             the revision it was recorded at and the time. Unique per target and per handle, never
--                             updated, deleted or truncated. No foreign key: it outlives the row it names.
--   lifecycle.ledger_outbox   the transactional outbox. Every committed Account status or epoch change, invitation or
--                             pre-authorization consumption, invitation revocation, recovery redemption and tombstone
--                             queues exactly one event, in the same transaction, by AFTER triggers on the tables
--                             themselves (so no path can forget, and a rolled-back change leaves no event). An event is
--                             {id, type, ...}: opaque IDs, statuses and revisions only, never an address, a title, a code,
--                             a token or a hash of one (a tombstone's carries the status handle). A row is immutable apart
--                             from being marked relayed, once. The relay takes events in `seq` order (the order they
--                             were queued in), which is also the order they committed in for the changes of one row (a
--                             second change waits for the first's row lock); two unrelated transactions that overlap may
--                             be appended in either order, each exactly once.
--   lifecycle.ledger_relay    the relay's lease: one row, one holder at a time, for a short while.
--   lifecycle.status_requests the counters of the status route's rate limit (per origin and global, per minute).
--
--   api.record_tombstone      the ONE writer of a tombstone, with no caller in the application. Idempotent. It locks the
--                             target row, takes revision = the target's next revision and, in one transaction, hides
--                             FIRST (an Account becomes `disabled` with its epoch raised by one, which ends every grant
--                             and operation registered under an older epoch, and its Auth sessions are deleted, as a disable
--                             does; a Project gets `deleted_at` and its revision raised by one), then inserts the tombstone,
--                             which queues its ledger event.
--                             recorded | exists (nothing changed; the first revision) | not_found
--   api.guard_target          the guard for a named target: allowed | disabled | stale_epoch | no_account | tombstoned |
--                             unavailable (a foreign, unknown, deleted or tombstoned Project is the same `unavailable`).
--   api.guard_operation       gains the outcome `tombstoned`.
--   lifecycle.assert_not_tombstoned
--                             the tombstone guard for SQL that publishes: raises N3010 (`tombstoned`). It is the first call
--                             of identity.assert_operation_authority and of api.guard_operation, so a tombstoned Account is
--                             refused before anything else about it is read.
--   api.claim_ledger_events / api.finish_ledger_events / api.ledger_pending
--                             the relay's database half (lib/ledger.ts is the other): take the lease and read the pending
--                             events in outbox order; mark one event relayed and release the lease; count what is pending
--                             and how old the oldest is.
--   api.lookup_status         the status route's database half: counts the request FIRST (120 per origin per minute, 1,200
--                             globally per minute, every request counted) and answers the state and revision of a handle.
--                             active | disabled | deleted | unknown | limited
--   api.preflight             re-created carrying every earlier probe and the new ones.
--
-- A tombstoned Account cannot be enabled (the Account guard trigger refuses, and api.enable_account answers `not_found`), a
-- tombstoned Project cannot be shown again (its guard refuses to clear `deleted_at`), and an Account or Project row cannot be
-- inserted with a tombstoned ID (BEFORE INSERT triggers): a deleted ID is never reused.
--
-- The Account gets `status_handle`: 16 random bytes, unique, not null, immutable, backfilled for the rows that exist. A
-- Project has had one since Story 1.7. No page, payload or function returns a handle to a browser: the two ways one leaves
-- the database are the status route's lookup, which RECEIVES one, and the tombstone event, which the relay writes to the ledger.
--
-- Same pattern as the earlier migrations: every table is closed explicitly (row-level security on, no policy, every privilege
-- revoked from public, anon, authenticated and service_role), because the `lifecycle` schema is one the Data API lists and the
-- default-privilege rules of 20261010120000_accounts.sql do not cover it. Reached only through `api` functions, which run as
-- the owner with an empty search_path and are executable by the service role alone.
--
-- Stable error code for SQL that publishes:
--   N3010  (as before) the operation's Account has no authority for it; the reason is the end of the message and is now
--          also `tombstoned`

-- The lifecycle schema is closed by default from now on ---------------------------------------------------------------------

alter default privileges for role postgres in schema lifecycle revoke execute on functions from public, anon, authenticated, service_role;
alter default privileges for role postgres in schema lifecycle revoke all on tables from public, anon, authenticated, service_role;
alter default privileges for role postgres in schema lifecycle revoke all on sequences from public, anon, authenticated, service_role;

-- Tombstones ----------------------------------------------------------------------------------------------------------------

create table lifecycle.tombstones (
  kind text not null check (kind in ('account', 'project')),
  target_id uuid not null,
  -- The target's status handle (16 random bytes), kept so the status route can answer `deleted` after the target is gone.
  status_handle bytea not null check (octet_length(status_handle) = 16),
  -- The revision the tombstone was recorded at: an Account's authorization epoch after the hide, a Project's own revision.
  revision bigint not null check (revision >= 1),
  recorded_at timestamptz not null default clock_timestamp(),
  primary key (kind, target_id),
  constraint tombstones_status_handle_key unique (status_handle)
);

comment on table lifecycle.tombstones is
  'One row per deleted Account or Project: kind, target ID, status handle, revision and time, and nothing else. Never updated, deleted or truncated. Written only by api.record_tombstone.';

create function lifecycle.refuse_change() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception '% is append-only', tg_table_schema || '.' || tg_table_name using errcode = '55000';
end;
$$;

create trigger tombstones_no_change before update or delete on lifecycle.tombstones
  for each row execute function lifecycle.refuse_change();
create trigger tombstones_no_truncate before truncate on lifecycle.tombstones
  for each statement execute function lifecycle.refuse_change();

-- Whether a target is tombstoned, and the guard for SQL that publishes. The guard raises N3010 (`tombstoned`), the code of
-- identity.assert_operation_authority, so a function that already catches a refusal of authority catches this one too.
create function lifecycle.is_tombstoned(p_kind text, p_target_id uuid) returns boolean
language sql
stable
set search_path = ''
as $$
  select exists (select 1 from lifecycle.tombstones t where t.kind = p_kind and t.target_id = p_target_id)
$$;

create function lifecycle.assert_not_tombstoned(p_kind text, p_target_id uuid) returns void
language plpgsql
stable
set search_path = ''
as $$
begin
  if p_kind is null or p_kind not in ('account', 'project') or p_target_id is null then
    raise exception 'invalid argument' using errcode = '22023';
  end if;
  if lifecycle.is_tombstoned(p_kind, p_target_id) then
    raise exception 'operation authority denied: tombstoned' using errcode = 'N3010';
  end if;
end;
$$;

comment on function lifecycle.assert_not_tombstoned(text, uuid) is
  'The tombstone guard for SQL that publishes: raises N3010 (tombstoned) when the target has a tombstone. Callable by no API role.';

-- The Account's status handle -----------------------------------------------------------------------------------------------

-- A volatile default: every existing row gets its own random value as the column is added.
alter table identity.accounts
  add column status_handle bytea not null default extensions.gen_random_bytes(16) check (octet_length(status_handle) = 16);
alter table identity.accounts add constraint accounts_status_handle_key unique (status_handle);

comment on column identity.accounts.status_handle is
  'Story 1.8. 16 random bytes, unique and never changed. A device presents it to the status route; no function returns it.';

-- The Account guard, as session_grants.sql left it, plus two things. The status handle can never change. And a tombstoned
-- Account cannot be made active again, whatever tries: the epoch may still rise, the status may not return to `active`.
create or replace function identity.guard_account() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.id <> old.id or new.user_id <> old.user_id or new.google_subject <> old.google_subject
     or new.source <> old.source or new.created_at <> old.created_at or new.status_handle <> old.status_handle then
    raise exception 'an Account cannot change its identity' using errcode = '55000';
  end if;
  if new.authorization_epoch < old.authorization_epoch then
    raise exception 'an authorization epoch only rises' using errcode = '55000';
  end if;
  if new.status = 'active' and old.status <> 'active' and lifecycle.is_tombstoned('account', old.id) then
    raise exception 'a tombstoned Account cannot be enabled' using errcode = '55000';
  end if;
  if new.status <> old.status then
    new.authorization_epoch := greatest(new.authorization_epoch, old.authorization_epoch + 1);
    perform identity.record_audit('system:accounts', 'account.epoch_raised', 'account:' || old.id::text);
  end if;
  return new;
end;
$$;

-- A hidden Project stays hidden for good once it has a tombstone: `deleted_at` cannot be cleared.
create function projects.guard_tombstoned_project() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if old.deleted_at is not null and new.deleted_at is null and lifecycle.is_tombstoned('project', old.id) then
    raise exception 'a tombstoned Project cannot be shown again' using errcode = '55000';
  end if;
  return new;
end;
$$;

create trigger projects_tombstoned_guard before update on projects.projects
  for each row execute function projects.guard_tombstoned_project();

-- A deleted ID is never reused ----------------------------------------------------------------------------------------------

-- Only the opaque identity is retained (the tombstone), and that is enough to refuse a new row with the same ID.
create function lifecycle.refuse_reused_id() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if lifecycle.is_tombstoned(tg_argv[0], new.id) then
    raise exception 'a tombstoned ID cannot be used again' using errcode = '55000';
  end if;
  return new;
end;
$$;

create trigger accounts_id_not_reused before insert on identity.accounts
  for each row execute function lifecycle.refuse_reused_id('account');
create trigger projects_id_not_reused before insert on projects.projects
  for each row execute function lifecycle.refuse_reused_id('project');

-- The outbox ----------------------------------------------------------------------------------------------------------------

create table lifecycle.ledger_outbox (
  -- The order the relay appends in.
  seq bigint generated always as identity primary key,
  id uuid not null unique,
  -- {id, type, ...}: kept as written (json, not jsonb), so the same event is the same bytes every time it is read.
  event json not null check (
    json_typeof(event) = 'object'
    and coalesce(event ->> 'id' = id::text, false)
    and coalesce(event ->> 'type' ~ '^[a-z][a-z_]*$', false)
  ),
  -- The event's own time: the ledger writes it, so a retry writes identical bytes.
  created_at timestamptz not null default clock_timestamp(),
  relayed_at timestamptz
);

comment on table lifecycle.ledger_outbox is
  'The transactional outbox of the restore ledger: one event per committed change, queued by triggers in the same transaction. Immutable apart from being marked relayed, once.';

create index ledger_outbox_pending on lifecycle.ledger_outbox (seq) where relayed_at is null;

create function lifecycle.guard_outbox() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.seq <> old.seq or new.id <> old.id or new.event::text <> old.event::text or new.created_at <> old.created_at then
    raise exception 'a ledger event is immutable' using errcode = '55000';
  end if;
  if old.relayed_at is not null or new.relayed_at is null then
    raise exception 'a ledger event is marked relayed once' using errcode = '55000';
  end if;
  return new;
end;
$$;

create trigger ledger_outbox_guard before update on lifecycle.ledger_outbox
  for each row execute function lifecycle.guard_outbox();
create trigger ledger_outbox_no_delete before delete on lifecycle.ledger_outbox
  for each row execute function lifecycle.refuse_change();
create trigger ledger_outbox_no_truncate before truncate on lifecycle.ledger_outbox
  for each statement execute function lifecycle.refuse_change();

-- The relay's lease: one row, at most one holder, for a short while. A crashed relay's lease simply runs out.
create table lifecycle.ledger_relay (
  id boolean primary key default true check (id),
  holder uuid,
  lease_expires_at timestamptz,
  check ((holder is null) = (lease_expires_at is null))
);

insert into lifecycle.ledger_relay (id) values (true);

-- The one row is the lease: without it nobody could ever take the lease, so it can be neither deleted nor truncated.
create trigger ledger_relay_no_delete before delete on lifecycle.ledger_relay
  for each row execute function lifecycle.refuse_change();
create trigger ledger_relay_no_truncate before truncate on lifecycle.ledger_relay
  for each statement execute function lifecycle.refuse_change();

comment on table lifecycle.ledger_relay is
  'The single-row lease of the ledger relay: who holds it and until when.';

-- The status route's counters: requests per origin (a keyed hash, never an address) and in all, per minute.
create table lifecycle.status_requests (
  scope text not null check (scope in ('origin', 'global')),
  key_hash text not null check (key_hash ~ '^[0-9a-f]{64}$' or key_hash = 'global'),
  window_id bigint not null,
  requests integer not null default 0 check (requests >= 0),
  expires_at timestamptz not null,
  primary key (scope, key_hash, window_id),
  check ((scope = 'global') = (key_hash = 'global'))
);

create index status_requests_expires_at on lifecycle.status_requests (expires_at);

comment on table lifecycle.status_requests is
  'Counters of the status route''s requests: per origin (a keyed hash) and global, per minute. Every request counts, answered or not.';

-- The triggers that queue an event ---------------------------------------------------------------------------------------------

create function lifecycle.append_event(p_event json) returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into lifecycle.ledger_outbox (id, event) values ((p_event ->> 'id')::uuid, p_event);
end;
$$;

-- An Account's status or epoch changed (a disable, a re-enable, a recovery's epoch raise, a tombstone's hide).
create function lifecycle.queue_account_authority() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid := gen_random_uuid();
begin
  perform lifecycle.append_event(json_build_object('id', v_id, 'type', 'account_authority', 'account_id', new.id, 'status', new.status, 'epoch', new.authorization_epoch));
  return null;
end;
$$;

create trigger accounts_ledger after update on identity.accounts
  for each row when (old.status is distinct from new.status or old.authorization_epoch is distinct from new.authorization_epoch)
  execute function lifecycle.queue_account_authority();

-- An invitation was consumed or revoked (a rotation revokes the current code and then issues a new one).
create function lifecycle.queue_invitation_change() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid := gen_random_uuid();
begin
  if old.status = 'unused' and new.status = 'redeemed' then
    perform lifecycle.append_event(json_build_object('id', v_id, 'type', 'invitation_consumed', 'invitation_id', new.id, 'account_id', new.redeemed_account_id));
  elsif old.status = 'unused' and new.status = 'revoked' then
    perform lifecycle.append_event(json_build_object('id', v_id, 'type', 'invitation_revoked', 'invitation_id', new.id));
  end if;
  return null;
end;
$$;

create trigger invitations_ledger after update on identity.invitations
  for each row when (old.status is distinct from new.status)
  execute function lifecycle.queue_invitation_change();

-- A pre-authorization was consumed (withdrawing an unconsumed one is not ledgered).
create function lifecycle.queue_preauthorization_consumed() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid := gen_random_uuid();
begin
  perform lifecycle.append_event(json_build_object('id', v_id, 'type', 'preauthorization_consumed', 'preauthorization_id', new.id, 'account_id', new.account_id));
  return null;
end;
$$;

create trigger preauthorizations_ledger after update on identity.preauthorizations
  for each row when (old.consumed_at is null and new.consumed_at is not null)
  execute function lifecycle.queue_preauthorization_consumed();

-- A recovery token was redeemed (its row's ID, never the token or its hash).
create function lifecycle.queue_recovery_redeemed() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid := gen_random_uuid();
begin
  perform lifecycle.append_event(json_build_object('id', v_id, 'type', 'recovery_redeemed', 'recovery_id', new.id, 'account_id', new.account_id));
  return null;
end;
$$;

create trigger recovery_tokens_ledger after update on identity.recovery_tokens
  for each row when (old.used_at is null and new.used_at is not null)
  execute function lifecycle.queue_recovery_redeemed();

-- A tombstone was recorded. This is the one event that carries a status handle: the ledger is what lets a device that holds
-- the handle learn, after a restore, that its target is gone.
create function lifecycle.queue_tombstone() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid := gen_random_uuid();
begin
  perform lifecycle.append_event(json_build_object('id', v_id, 'type', 'tombstone', 'kind', new.kind, 'target_id', new.target_id, 'handle', encode(new.status_handle, 'hex'), 'revision', new.revision));
  return null;
end;
$$;

create trigger tombstones_ledger after insert on lifecycle.tombstones
  for each row execute function lifecycle.queue_tombstone();

-- Closed by default ------------------------------------------------------------------------------------------------------------

alter table lifecycle.tombstones enable row level security;
alter table lifecycle.ledger_outbox enable row level security;
alter table lifecycle.ledger_relay enable row level security;
alter table lifecycle.status_requests enable row level security;
-- No policies on any of them: only the owner and roles that bypass RLS can read a row, and the privileges below leave anon,
-- authenticated and service_role no path to the tables at all.
revoke all on lifecycle.tombstones from public, anon, authenticated, service_role;
revoke all on lifecycle.ledger_outbox from public, anon, authenticated, service_role;
revoke all on lifecycle.ledger_relay from public, anon, authenticated, service_role;
revoke all on lifecycle.status_requests from public, anon, authenticated, service_role;
revoke all on all sequences in schema lifecycle from public, anon, authenticated, service_role;
revoke all on all functions in schema lifecycle from public, anon, authenticated, service_role;

-- The authority checks, now with the tombstone guard first ------------------------------------------------------------------------

-- As 20261012130000_account_administration.sql defined it, with the tombstone guard as the first statement: a tombstoned Account
-- is refused (N3010, `tombstoned`) before its row is read or locked.
create or replace function identity.assert_operation_authority(p_account_id uuid, p_epoch bigint) returns void
language plpgsql
set search_path = ''
as $$
declare
  v_account identity.accounts;
begin
  perform lifecycle.assert_not_tombstoned('account', p_account_id);
  if p_account_id is null or p_epoch is null or p_epoch < 1 then
    raise exception 'invalid argument' using errcode = '22023';
  end if;
  select * into v_account from identity.accounts a where a.id = p_account_id for share;
  if not found then
    raise exception 'operation authority denied: no_account' using errcode = 'N3010';
  end if;
  if v_account.status <> 'active' then
    raise exception 'operation authority denied: disabled' using errcode = 'N3010';
  end if;
  if v_account.authorization_epoch <> p_epoch then
    raise exception 'operation authority denied: stale_epoch' using errcode = 'N3010';
  end if;
end;
$$;

comment on function identity.assert_operation_authority(uuid, bigint) is
  'For SQL that publishes: refuses a tombstoned Account first (N3010), then takes the Account FOR SHARE and raises N3010 unless it is active under the epoch the operation registered under.';

-- As before, with the outcome `tombstoned`, decided first. epoch is the Account's current epoch (null when the row is gone).
--   allowed | disabled | stale_epoch | no_account | tombstoned
create or replace function api.guard_operation(p_account_id uuid, p_epoch bigint)
returns api.operation_guard
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_result api.operation_guard;
  v_account identity.accounts;
begin
  if p_account_id is null or p_epoch is null or p_epoch < 1 then
    raise exception 'invalid argument' using errcode = '22023';
  end if;
  begin
    perform lifecycle.assert_not_tombstoned('account', p_account_id);
  exception when sqlstate 'N3010' then
    select a.authorization_epoch into v_result.epoch from identity.accounts a where a.id = p_account_id;
    v_result.outcome := 'tombstoned';
    return v_result;
  end;
  select * into v_account from identity.accounts a where a.id = p_account_id;
  if not found then
    v_result.outcome := 'no_account';
    return v_result;
  end if;
  v_result.epoch := v_account.authorization_epoch;
  v_result.outcome := case
    when v_account.status <> 'active' then 'disabled'
    when v_account.authorization_epoch <> p_epoch then 'stale_epoch'
    else 'allowed'
  end;
  return v_result;
end;
$$;

comment on function api.guard_operation(uuid, bigint) is
  'The authority check for an application step of an operation registered under an epoch: allowed | disabled | stale_epoch | no_account | tombstoned. Read-only.';

-- Enabling, as before, except that a tombstoned Account is not found. (The Account guard trigger refuses it as well.)
create or replace function api.enable_account(p_actor text, p_account_id uuid)
returns api.account_enabling
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_result api.account_enabling;
  v_account identity.accounts;
begin
  if p_actor is null or p_actor !~ '^[a-z][a-z_]*(:[A-Za-z0-9_-]{1,64}){0,2}$' or p_account_id is null then
    raise exception 'invalid argument' using errcode = '22023';
  end if;

  select * into v_account from identity.accounts a where a.id = p_account_id for update;
  -- Read after the row is locked: a tombstone recorded while this waited is seen.
  if not found or lifecycle.is_tombstoned('account', p_account_id) then
    v_result.outcome := 'not_found';
    return v_result;
  end if;
  if v_account.status = 'active' then
    v_result.outcome := 'already_enabled';
    v_result.epoch := v_account.authorization_epoch;
    return v_result;
  end if;

  update identity.accounts a set status = 'active' where a.id = v_account.id
    returning a.authorization_epoch into v_result.epoch;
  perform identity.record_audit(p_actor, 'account.enabled', 'account:' || v_account.id::text);
  v_result.outcome := 'enabled';
  return v_result;
end;
$$;

comment on function api.enable_account(text, uuid) is
  'Enables a disabled Account under a newer epoch and audits account.enabled. Revoked grants and ended Auth sessions stay ended. A tombstoned Account is not found. enabled | already_enabled | not_found.';

-- The writer ----------------------------------------------------------------------------------------------------------------------

create type api.tombstone_receipt as (outcome text, kind text, target_id uuid, revision bigint);

-- Records a tombstone for an Account or a Project. In one transaction, under a lock on the target's row:
--   1. a tombstone that exists already is the answer (`exists`, with the revision it was recorded at; nothing changes);
--   2. the revision is the target's NEXT revision: an Account's epoch plus one, a Project's revision plus one;
--   3. the target is HIDDEN first: an Account becomes `disabled` with its epoch raised to that revision (which ends every grant
--      and every operation registered under an older epoch; the status trigger queues the Account's own authority event; and the
--      person's Auth sessions are deleted, so no refresh token can mint another access token), a Project gets `deleted_at` and its
--      revision raised;
--   4. the tombstone is inserted, which queues its ledger event.
-- A target that is not there, and has no tombstone, is `not_found`. Nothing in the application calls this: Epic 8 will.
--   recorded | exists | not_found
create function api.record_tombstone(p_kind text, p_target_id uuid)
returns api.tombstone_receipt
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_result api.tombstone_receipt;
  v_found boolean;
  v_handle bytea;
  v_user_id uuid;
  v_revision bigint;
  v_existing lifecycle.tombstones;
begin
  if p_kind is null or p_kind not in ('account', 'project') or p_target_id is null then
    raise exception 'invalid argument' using errcode = '22023';
  end if;
  v_result.kind := p_kind;
  v_result.target_id := p_target_id;

  -- The lock on the target's row serializes two recordings; the tombstone is read after it, so the second sees the first.
  if p_kind = 'account' then
    select a.status_handle, a.user_id into v_handle, v_user_id from identity.accounts a where a.id = p_target_id for update;
  else
    select p.status_handle into v_handle from projects.projects p where p.id = p_target_id for update;
  end if;
  v_found := found;

  select * into v_existing from lifecycle.tombstones t where t.kind = p_kind and t.target_id = p_target_id;
  if found then
    v_result.outcome := 'exists';
    v_result.revision := v_existing.revision;
    return v_result;
  end if;
  if not v_found then
    v_result.outcome := 'not_found';
    return v_result;
  end if;

  if p_kind = 'account' then
    -- The explicit raise covers an Account that is already disabled (no status change, so the guard would not raise it).
    update identity.accounts a
       set status = 'disabled', authorization_epoch = a.authorization_epoch + 1
     where a.id = p_target_id
     returning a.authorization_epoch into v_revision;
    -- Ends the person's Auth sessions, as api.disable_account does, so no refresh token can mint another access token. Done by the
    -- function's owner in this transaction; api.preflight probes that the owner may. Not audited: the ledger event is the record.
    delete from auth.sessions s where s.user_id = v_user_id;
  else
    update projects.projects p
       set deleted_at = coalesce(p.deleted_at, clock_timestamp()), revision = p.revision + 1
     where p.id = p_target_id
     returning p.revision into v_revision;
  end if;

  insert into lifecycle.tombstones (kind, target_id, status_handle, revision)
    values (p_kind, p_target_id, v_handle, v_revision);

  v_result.outcome := 'recorded';
  v_result.revision := v_revision;
  return v_result;
end;
$$;

comment on function api.record_tombstone(text, uuid) is
  'The one writer of a tombstone: hides the target first (an Account is disabled under a raised epoch and its Auth sessions are deleted, a Project gets deleted_at and a new revision), then inserts the tombstone and queues its ledger event, in one transaction under a lock on the target. Idempotent. recorded | exists | not_found. No caller in the application.';

-- The guard for a named target --------------------------------------------------------------------------------------------------------

create type api.target_guard as (outcome text, epoch bigint);

-- May an operation of this Account, registered under this epoch, act on this target now? The Account is asked first, exactly
-- as api.guard_operation asks (so a tombstoned or disabled Account, or a stale epoch, is answered as there); then the target:
--   project   it exists, is this Account's, is not deleted and has no tombstone: allowed. Anything else, a Project that is
--             another Account's, unknown, deleted or tombstoned, is the very same `unavailable`, with nothing in it.
--   account   only the operation's own Account: allowed. Another Account is `unavailable`.
-- Read-only; the guard rejects before any other effect and discloses nothing of the target.
--   allowed | disabled | stale_epoch | no_account | tombstoned | unavailable
create function api.guard_target(p_account_id uuid, p_epoch bigint, p_kind text, p_target_id uuid)
returns api.target_guard
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_result api.target_guard;
  v_guard api.operation_guard;
begin
  if p_account_id is null or p_epoch is null or p_epoch < 1 or p_kind is null or p_kind not in ('account', 'project') or p_target_id is null then
    raise exception 'invalid argument' using errcode = '22023';
  end if;

  v_guard := api.guard_operation(p_account_id, p_epoch);
  v_result.epoch := v_guard.epoch;
  if v_guard.outcome <> 'allowed' then
    v_result.outcome := v_guard.outcome;
    return v_result;
  end if;

  begin
    perform lifecycle.assert_not_tombstoned(p_kind, p_target_id);
  exception when sqlstate 'N3010' then
    v_result.outcome := 'unavailable';
    return v_result;
  end;

  if p_kind = 'account' then
    v_result.outcome := case when p_target_id = p_account_id then 'allowed' else 'unavailable' end;
  else
    v_result.outcome := case
      when exists (select 1 from projects.projects p where p.id = p_target_id and p.account_id = p_account_id and p.deleted_at is null) then 'allowed'
      else 'unavailable'
    end;
  end if;
  return v_result;
end;
$$;

comment on function api.guard_target(uuid, bigint, text, uuid) is
  'The authority and tombstone guard for a named target (account or project): allowed | disabled | stale_epoch | no_account | tombstoned | unavailable. A foreign, unknown, deleted or tombstoned Project is the same unavailable. Read-only.';

-- The relay's database half -------------------------------------------------------------------------------------------------------------

create type api.ledger_claim as (outcome text, events json);
create type api.ledger_finish as (marked integer, released boolean);
create type api.ledger_backlog as (pending integer, oldest_seconds bigint);

-- Takes the relay's lease for p_holder (for p_lease_seconds) and reads the oldest pending events in outbox order, at most
-- p_limit. The lease is free when nobody holds it, when it has run out (a crashed relay's) or when p_holder holds it already
-- (which renews it). Each event is {id, seq, event, at}: `event` is the queued {id, type, ...} as written, `at` its own time,
-- in UTC to the millisecond, as the ledger writes it.
--   claimed | busy (someone else holds the lease; nothing is read)
create function api.claim_ledger_events(p_holder uuid, p_limit integer default 50, p_lease_seconds integer default 30)
returns api.ledger_claim
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_result api.ledger_claim;
begin
  if p_holder is null or p_limit is null or p_limit not between 1 and 200 or p_lease_seconds is null or p_lease_seconds not between 1 and 300 then
    raise exception 'invalid argument' using errcode = '22023';
  end if;

  update lifecycle.ledger_relay r
     set holder = p_holder, lease_expires_at = clock_timestamp() + make_interval(secs => p_lease_seconds)
   where r.id and (r.holder is null or r.lease_expires_at <= clock_timestamp() or r.holder = p_holder);
  if not found then
    v_result.outcome := 'busy';
    v_result.events := '[]'::json;
    return v_result;
  end if;

  select coalesce(json_agg(json_build_object(
           'id', o.id, 'seq', o.seq, 'event', o.event,
           'at', to_char(o.created_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
         ) order by o.seq), '[]'::json)
    into v_result.events
    from (select x.id, x.seq, x.event, x.created_at from lifecycle.ledger_outbox x where x.relayed_at is null order by x.seq limit p_limit) o;
  v_result.outcome := 'claimed';
  return v_result;
end;
$$;

comment on function api.claim_ledger_events(uuid, integer, integer) is
  'Takes the relay lease and reads the oldest pending ledger events in outbox order. claimed | busy.';

-- Marks the given events relayed (once; one already marked is left as it was) and, when asked, lets go of the lease if
-- p_holder still holds it. Marking is true whoever holds the lease now: the event is in the ledger store.
create function api.finish_ledger_events(p_holder uuid, p_event_ids uuid[], p_release boolean default false)
returns api.ledger_finish
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_result api.ledger_finish;
  v_marked integer;
begin
  if p_holder is null or p_event_ids is null or cardinality(p_event_ids) > 200 or p_release is null then
    raise exception 'invalid argument' using errcode = '22023';
  end if;

  update lifecycle.ledger_outbox o set relayed_at = clock_timestamp()
   where o.id = any(p_event_ids) and o.relayed_at is null;
  get diagnostics v_marked = row_count;
  v_result.marked := v_marked;

  v_result.released := false;
  if p_release then
    update lifecycle.ledger_relay r set holder = null, lease_expires_at = null where r.id and r.holder = p_holder;
    v_result.released := found;
  end if;
  return v_result;
end;
$$;

comment on function api.finish_ledger_events(uuid, uuid[], boolean) is
  'Marks ledger events relayed, once each, and optionally releases the relay lease held by p_holder.';

-- How many events are waiting for the relay and how old the oldest is (null when none): what the alarm of Story 1.13 reads.
create function api.ledger_pending()
returns api.ledger_backlog
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_result api.ledger_backlog;
  v_oldest timestamptz;
begin
  select count(*)::integer, min(o.created_at) into v_result.pending, v_oldest from lifecycle.ledger_outbox o where o.relayed_at is null;
  v_result.oldest_seconds := case when v_oldest is null then null else greatest(floor(extract(epoch from clock_timestamp() - v_oldest)), 0)::bigint end;
  return v_result;
end;
$$;

comment on function api.ledger_pending() is
  'The number of ledger events not yet relayed and the age in seconds of the oldest (null when none). Read-only.';

-- The status route's database half -----------------------------------------------------------------------------------------------------

-- `revision` is the status reply's monotonic number (see api.lookup_status for what it is for an Account, a Project and a tombstone);
-- `retry_after` is the seconds left in the minute, set only for `limited`.
create type api.status_lookup as (outcome text, revision bigint, retry_after integer);

-- Answers what a handle's target is now, for a device that holds the handle and may have no Account any more. Nothing identifies
-- the caller but its origin, which the application passes as a keyed hash (the way registration does, never an address). The
-- request is COUNTED FIRST, answered or not: 120 per origin and 1,200 in all per minute, in fixed minutes. Over either is
-- `limited`, with the seconds left in the minute, and nothing is looked up.
--   active | disabled | deleted   with the revision: an Account's is its authorization epoch; a Project's is its own revision PLUS
--                                 its Account's authorization epoch (both only rise, so a disable and a re-enable of the Account
--                                 each raise it, and a device sees the Project become active again); a tombstone's is the revision
--                                 it was recorded at (`deleted` is terminal, so that number never lifts anything). A Project's
--                                 `disabled` follows its Account.
--   unknown                       no such handle
--   limited
-- A deleted handle is answered from its tombstone, so it stays answerable after the target and its Auth user are gone.
create function api.lookup_status(p_handle text, p_origin_hash text)
returns api.status_lookup
language plpgsql
security definer
set search_path = ''
as $$
declare
  c_origin_limit constant integer := 120;
  c_global_limit constant integer := 1200;
  v_epoch bigint := floor(extract(epoch from clock_timestamp()))::bigint;
  v_window bigint := v_epoch / 60;
  v_origin_requests integer;
  v_global_requests integer;
  v_result api.status_lookup;
  v_handle bytea;
  v_state text;
  v_revision bigint;
begin
  if p_handle is null or p_handle !~ '^[0-9a-f]{32}$' or p_origin_hash is null or p_origin_hash !~ '^[0-9a-f]{64}$' then
    raise exception 'invalid argument' using errcode = '22023';
  end if;

  -- Counted first. The counters are locked in a fixed order (origin, then global).
  insert into lifecycle.status_requests as c (scope, key_hash, window_id, requests, expires_at)
    values ('origin', p_origin_hash, v_window, 1, to_timestamp((v_window + 1) * 60 + 60))
    on conflict (scope, key_hash, window_id) do update set requests = c.requests + 1
    returning c.requests into v_origin_requests;
  insert into lifecycle.status_requests as c (scope, key_hash, window_id, requests, expires_at)
    values ('global', 'global', v_window, 1, to_timestamp((v_window + 1) * 60 + 60))
    on conflict (scope, key_hash, window_id) do update set requests = c.requests + 1
    returning c.requests into v_global_requests;
  -- Expired windows are dropped a few at a time, never waiting on a locked row.
  delete from lifecycle.status_requests d
   where d.ctid in (
     select s.ctid from lifecycle.status_requests s
      where s.expires_at < clock_timestamp()
      order by s.expires_at
      limit 50
      for update skip locked
   );

  if v_origin_requests > c_origin_limit or v_global_requests > c_global_limit then
    v_result.outcome := 'limited';
    v_result.retry_after := greatest(((v_window + 1) * 60 - v_epoch)::integer, 1);
    return v_result;
  end if;

  v_handle := decode(p_handle, 'hex');

  select t.revision into v_revision from lifecycle.tombstones t where t.status_handle = v_handle;
  if found then
    v_result.outcome := 'deleted';
    v_result.revision := v_revision;
    return v_result;
  end if;

  select a.status, a.authorization_epoch into v_state, v_revision from identity.accounts a where a.status_handle = v_handle;
  if found then
    v_result.outcome := v_state;
    v_result.revision := v_revision;
    return v_result;
  end if;

  -- A Project's revision, as a device sees it, is its own plus its Account's authorization epoch: both only rise, so the Account's
  -- disable and its re-enable each give the Project's reply a higher number than the one before, and the merge rule lifts a `disabled`
  -- Project when its Account is enabled again (with the Project's own revision alone, `disabled` and `active` would carry the same
  -- number and the more restrictive state would stay for ever). A rename raises it too.
  select case when p.deleted_at is not null then 'deleted' when a.status <> 'active' then 'disabled' else 'active' end,
         p.revision + a.authorization_epoch
    into v_state, v_revision
    from projects.projects p join identity.accounts a on a.id = p.account_id
   where p.status_handle = v_handle;
  if found then
    v_result.outcome := v_state;
    v_result.revision := v_revision;
    return v_result;
  end if;

  v_result.outcome := 'unknown';
  return v_result;
end;
$$;

comment on function api.lookup_status(text, text) is
  'The status of a handle: active | disabled | deleted with a revision, unknown, or limited (120 per origin and 1,200 in all per minute; every request is counted first). An Account''s revision is its authorization epoch, a Project''s is its own revision plus its Account''s epoch, and a deleted handle is answered from its tombstone, with the revision it was recorded at.';

-- The preflight -------------------------------------------------------------------------------------------------------------------------

-- Everything api.preflight read before (20261012150000_projects.sql), plus what this story depends on: the four tables (with the
-- columns the functions use) and the Account's status handle are read, and the seven functions of this story (the six in `api` and
-- lifecycle.assert_not_tombstoned) exist. The service role must be able to execute all eighteen `api` functions the preflight names
-- (five of Story 1.5, four of 1.6, three of 1.7 and the six of this story). It checks the catalog and executes none of them, reads at
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
      'api.lookup_status(text,text)'
    ]) as f(signature)
   where not has_function_privilege('service_role', f.signature, 'execute');
  if v_missing is not null then
    raise exception 'api.preflight: the service role cannot execute %', v_missing using errcode = '42501';
  end if;

  if not has_table_privilege('auth.sessions', 'DELETE') then
    raise exception 'api.preflight: permission denied to end Auth sessions (delete on auth.sessions)' using errcode = '42501';
  end if;

  v_result.ok := true;
  return v_result;
end;
$$;

comment on function api.preflight() is
  'Reads identity.session_grants (including its CSRF columns), identity.accounts (including its status handle), identity.account_preferences, identity.step_up_nonces, identity.fresh_authentications (including source), identity.recovery_tokens, projects.projects, projects.project_commands, lifecycle.tombstones, lifecycle.ledger_outbox, lifecycle.ledger_relay, lifecycle.status_requests, auth.sessions, auth.identities and auth.mfa_amr_claims (one row each at most), checks that the Story 1.5, 1.6, 1.7 and 1.8 functions exist and are executable by the service role and that the owner may delete from auth.sessions, and answers ok. Read-only.';

-- Access --------------------------------------------------------------------------------------------------------------------------------

-- Closed by default; only the service role is let in, by name. lifecycle.* and identity.* helpers are granted to nobody: SQL that
-- runs as the owner calls them. (create or replace keeps the grants api.guard_operation, api.enable_account and api.preflight had.)
grant execute on function api.record_tombstone(text, uuid) to service_role;
grant execute on function api.guard_target(uuid, bigint, text, uuid) to service_role;
grant execute on function api.claim_ledger_events(uuid, integer, integer) to service_role;
grant execute on function api.finish_ledger_events(uuid, uuid[], boolean) to service_role;
grant execute on function api.ledger_pending() to service_role;
grant execute on function api.lookup_status(text, text) to service_role;

-- New functions and types: have the Data API reload its schema cache now.
notify pgrst, 'reload schema';
