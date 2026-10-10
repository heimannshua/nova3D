-- Story 1.3 (Part A: database): invitation-only Accounts.
--
-- Identity owns Accounts, invitations, pre-authorizations, the append-only audit-event family,
-- the registration limiter and the registration command ledger. Projects owns the Workspace
-- record and its provisioning command. Both schemas are unexposed: the only callable surface is
-- the `api` schema (next migration), whose functions only the service role may execute.
--
-- Nothing here stores a raw invitation code or a client address. The application computes
-- HMAC-SHA256 hashes (lib/accounts.ts) and passes the hashes in.
--
-- Pattern (as in instance_identity): row-level security on, no policies, every privilege revoked
-- from public, anon, authenticated and service_role. The service role reaches this data only by
-- executing `api` functions, which run as the table owner.

create schema if not exists identity;
create schema if not exists projects;

comment on schema identity is 'Story 1.3. Accounts, invitations, audit events. Not exposed; reached only through api functions.';
comment on schema projects is 'Story 1.3. Workspaces. Not exposed; reached only through api functions.';

revoke all on schema identity from public, anon, authenticated, service_role;
revoke all on schema projects from public, anon, authenticated, service_role;

-- Closed by default. Postgres grants EXECUTE on every new function to PUBLIC unless the creating role's
-- default privileges say otherwise, and an `IN SCHEMA` revoke cannot remove that built-in default, so the
-- first statement is the one that works: no function this role creates from now on is executable by
-- PUBLIC (Supabase's own default grants for the `public` schema name anon, authenticated and service_role
-- explicitly and are untouched). The `IN SCHEMA` statements keep these schemas closed should anyone add
-- an in-schema default grant later. A future function or table here is callable by nobody until a
-- migration grants it on purpose.
alter default privileges for role postgres revoke execute on functions from public;
alter default privileges for role postgres in schema identity, projects revoke execute on functions from public, anon, authenticated, service_role;
alter default privileges for role postgres in schema identity, projects revoke all on tables from public, anon, authenticated, service_role;
alter default privileges for role postgres in schema identity, projects revoke all on sequences from public, anon, authenticated, service_role;

-- Accounts ---------------------------------------------------------------------------------------

create table identity.accounts (
  id uuid primary key default gen_random_uuid(),
  -- RESTRICT: an Auth user that owns an Account cannot be deleted by a purge or by accident.
  user_id uuid not null unique references auth.users (id) on delete restrict,
  google_subject text not null unique check (length(google_subject) between 1 and 255),
  role text not null check (role in ('administrator', 'member')),
  status text not null default 'active' check (status in ('active', 'disabled')),
  source text not null check (source in ('invitation', 'preauthorization')),
  created_at timestamptz not null default now()
);

comment on table identity.accounts is
  'One row per activated Account. Created only by identity.activate_account. Story 1.5 owns status changes.';

-- Who an Account is can never change: its Auth user, its Google subject, how it was created. Role and
-- status stay changeable for the stories that own them (1.5 disables and re-enables, 1.6 recovers).
create function identity.guard_account() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.id <> old.id or new.user_id <> old.user_id or new.google_subject <> old.google_subject
     or new.source <> old.source or new.created_at <> old.created_at then
    raise exception 'an Account cannot change its identity' using errcode = '55000';
  end if;
  return new;
end;
$$;

create trigger accounts_guard before update on identity.accounts
  for each row execute function identity.guard_account();

-- Invitations ------------------------------------------------------------------------------------

create table identity.invitations (
  id uuid primary key default gen_random_uuid(),
  -- HMAC-SHA256 (hex) of the canonical code under INVITATION_HASH_KEY. The code itself is never stored.
  code_hash text not null unique check (code_hash ~ '^[0-9a-f]{64}$'),
  kind text not null check (kind in ('named', 'general')),
  label text check (label is null or length(label) between 1 and 80),
  status text not null default 'unused' check (status in ('unused', 'redeemed', 'revoked')),
  issued_by text not null check (issued_by ~ '^[a-z][a-z_]*(:[A-Za-z0-9_-]{1,64}){0,2}$'),
  created_at timestamptz not null default now(),
  redeemed_at timestamptz,
  redeemed_account_id uuid references identity.accounts (id) on delete restrict,
  revoked_at timestamptz,
  revoked_by text check (revoked_by is null or revoked_by ~ '^[a-z][a-z_]*(:[A-Za-z0-9_-]{1,64}){0,2}$'),
  -- A named code carries the invitee's label; a general code carries none.
  check ((kind = 'named') = (label is not null)),
  check ((status = 'redeemed') = (redeemed_at is not null and redeemed_account_id is not null)),
  check ((status = 'revoked') = (revoked_at is not null and revoked_by is not null))
);

-- At most one current general code. Codes never expire: an unused row stays valid until it is
-- redeemed or revoked.
create unique index invitations_one_current_general on identity.invitations (kind) where kind = 'general' and status = 'unused';

comment on table identity.invitations is
  'Hashed single-use invitation codes. Unused codes never expire; only redemption or revocation ends one.';

create function identity.guard_invitation() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if old.status <> 'unused' then
    raise exception 'a redeemed or revoked invitation is final' using errcode = '55000';
  end if;
  if new.id <> old.id or new.code_hash <> old.code_hash or new.kind <> old.kind or new.created_at <> old.created_at then
    raise exception 'an invitation cannot change its identity' using errcode = '55000';
  end if;
  return new;
end;
$$;

create trigger invitations_guard before update on identity.invitations
  for each row execute function identity.guard_invitation();

-- Pre-authorizations -----------------------------------------------------------------------------

create table identity.preauthorizations (
  id uuid primary key default gen_random_uuid(),
  email text not null unique check (
    email = lower(btrim(email)) and length(email) <= 254 and email ~ '^[^\s@,;]+@[^\s@,;]+\.[^\s@,;]+$'
  ),
  role text not null check (role in ('administrator', 'member')),
  created_by text not null check (created_by ~ '^[a-z][a-z_]*(:[A-Za-z0-9_-]{1,64}){0,2}$'),
  created_at timestamptz not null default now(),
  -- Set once, at the address's first verified Google sign-in: the Account it activated and the
  -- Google subject pinned to it.
  consumed_at timestamptz,
  account_id uuid unique references identity.accounts (id) on delete restrict,
  google_subject text,
  check ((consumed_at is null) = (account_id is null) and (consumed_at is null) = (google_subject is null))
);

comment on table identity.preauthorizations is
  'Addresses seeded by the audited seed command. Consumed once, by api.consume_preauthorization, which pins the Google subject.';

create function identity.guard_preauthorization() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if old.consumed_at is not null then
    raise exception 'a consumed pre-authorization is final' using errcode = '55000';
  end if;
  if new.id <> old.id or new.email <> old.email or new.role <> old.role or new.created_at <> old.created_at then
    raise exception 'a pre-authorization cannot change its address or role' using errcode = '55000';
  end if;
  return new;
end;
$$;

create trigger preauthorizations_guard before update on identity.preauthorizations
  for each row execute function identity.guard_preauthorization();

-- Registration attempts --------------------------------------------------------------------------

-- The last time this Auth identity tried to register, written under the identity's row lock. The
-- dormant-identity purge of Story 1.9 reads it. It goes with the Auth user when the user is deleted.
create table identity.registration_attempts (
  user_id uuid primary key references auth.users (id) on delete cascade,
  last_attempt_at timestamptz not null default now()
);

comment on table identity.registration_attempts is
  'Last registration attempt per Auth identity, persisted under the auth.users row lock. Shared with the Story 1.9 purge.';

-- Registration commands --------------------------------------------------------------------------

-- Only successful registrations are recorded. A repeat of the same command and payload returns the
-- original receipt; the same command ID with another payload is refused.
create table identity.registration_commands (
  command_id uuid primary key,
  account_id uuid not null unique references identity.accounts (id) on delete restrict,
  code_hash text not null check (code_hash ~ '^[0-9a-f]{64}$'),
  created_at timestamptz not null default now()
);

comment on table identity.registration_commands is
  'Idempotency ledger of successful registrations, keyed by the client command UUID.';

-- Rate limiting ----------------------------------------------------------------------------------

-- Failure counters in fixed windows: floor(epoch / 900) per origin hash, floor(epoch / 3600) for the
-- one global key. The origin key is an HMAC under RATE_LIMIT_HASH_KEY, never an address.
create table identity.rate_limit_counters (
  scope text not null check (scope in ('origin', 'global')),
  key_hash text not null check (key_hash ~ '^[0-9a-f]{64}$' or key_hash = 'global'),
  window_id bigint not null,
  failures integer not null default 0 check (failures >= 0),
  expires_at timestamptz not null,
  primary key (scope, key_hash, window_id),
  check ((scope = 'global') = (key_hash = 'global'))
);

create index rate_limit_counters_expires_at on identity.rate_limit_counters (expires_at);

comment on table identity.rate_limit_counters is
  'Registration failure counters keyed by a keyed hash of the client address, or the global key, and a time window.';

-- Audit events -----------------------------------------------------------------------------------

-- Who did what to which opaque target, and when. No content: no address, label, code or message.
create table identity.audit_events (
  id bigint generated always as identity primary key,
  occurred_at timestamptz not null default clock_timestamp(),
  actor text not null check (actor ~ '^[a-z][a-z_]*(:[A-Za-z0-9_-]{1,64}){0,2}$'),
  action text not null check (action ~ '^[a-z][a-z_]*(\.[a-z][a-z_]*)+$'),
  target text check (target is null or target ~ '^[a-z][a-z_]*:[A-Za-z0-9_-]{1,64}$')
);

comment on table identity.audit_events is
  'Identity-owned append-only audit family (Stories 1.3, 1.5, 1.6, 1.11, 2.4). Update, delete and truncate are refused.';

create function identity.refuse_audit_change() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'identity.audit_events is append-only' using errcode = '55000';
end;
$$;

create trigger audit_events_append_only before update or delete on identity.audit_events
  for each row execute function identity.refuse_audit_change();
create trigger audit_events_no_truncate before truncate on identity.audit_events
  for each statement execute function identity.refuse_audit_change();

create index audit_events_actor_action on identity.audit_events (actor, action, occurred_at desc);

create function identity.record_audit(p_actor text, p_action text, p_target text default null) returns void
language plpgsql
set search_path = ''
as $$
begin
  insert into identity.audit_events (actor, action, target) values (p_actor, p_action, p_target);
end;
$$;

-- For refusals that a caller can repeat at will (every sign-in): the same actor, action and target is
-- recorded at most once an hour, so an append-only table cannot be grown without bound.
create function identity.record_audit_once(p_actor text, p_action text, p_target text default null) returns void
language plpgsql
set search_path = ''
as $$
begin
  if not exists (
    select 1 from identity.audit_events e
     where e.actor = p_actor and e.action = p_action and e.target is not distinct from p_target
       and e.occurred_at > clock_timestamp() - interval '1 hour'
  ) then
    insert into identity.audit_events (actor, action, target) values (p_actor, p_action, p_target);
  end if;
end;
$$;

-- Workspaces -------------------------------------------------------------------------------------

create table projects.workspaces (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null unique references identity.accounts (id) on delete restrict,
  created_at timestamptz not null default now()
);

comment on table projects.workspaces is
  'The private Workspace of one Account. Created only by projects.provision_workspace.';

-- The Projects-owned provisioning command. Idempotent: a second call returns the existing Workspace.
-- Registration calls it in the same transaction that creates the Account.
create function projects.provision_workspace(p_account_id uuid) returns uuid
language plpgsql
set search_path = ''
as $$
declare
  v_workspace_id uuid;
begin
  insert into projects.workspaces (account_id) values (p_account_id)
    on conflict (account_id) do nothing
    returning id into v_workspace_id;
  if v_workspace_id is null then
    select w.id into v_workspace_id from projects.workspaces w where w.account_id = p_account_id;
  end if;
  return v_workspace_id;
end;
$$;

-- The one function that creates an Account, shared by code redemption and pre-authorization. It
-- creates the Account and its Workspace together; the caller supplies the transaction.
create function identity.activate_account(p_user_id uuid, p_subject text, p_role text, p_source text) returns uuid
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
  return v_account_id;
end;
$$;

-- Access -----------------------------------------------------------------------------------------

alter table identity.accounts enable row level security;
alter table identity.invitations enable row level security;
alter table identity.preauthorizations enable row level security;
alter table identity.registration_attempts enable row level security;
alter table identity.registration_commands enable row level security;
alter table identity.rate_limit_counters enable row level security;
alter table identity.audit_events enable row level security;
alter table projects.workspaces enable row level security;
-- No policies on any of them: only the owner and roles that bypass RLS can read a row, and the
-- privileges below leave anon, authenticated and service_role no path to the tables at all.

revoke all on all tables in schema identity from public, anon, authenticated, service_role;
revoke all on all tables in schema projects from public, anon, authenticated, service_role;
revoke all on all sequences in schema identity from public, anon, authenticated, service_role;
revoke all on all functions in schema identity from public, anon, authenticated, service_role;
revoke all on all functions in schema projects from public, anon, authenticated, service_role;
