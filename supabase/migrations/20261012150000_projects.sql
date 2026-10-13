-- Story 1.7: navigate My Projects and project state.
--
-- Projects owns the Project record. An Account owner finds and reopens their Projects; nothing here creates, deletes or
-- otherwise changes one except the first command, Rename. The record, the command ledger and three functions:
--
--   projects.projects          one row per Project: the owning Workspace and Account (a composite foreign key, so a
--                              Project can never point at another Account's Workspace), a title, one of six stages, the
--                              current Version number (0 means none), a revision counter, a random 128-bit status handle,
--                              and the times. `deleted_at` hides a Project; nothing sets it yet (Story 8.x does). The
--                              status handle is Story 1.8's: no function returns it and no function reads it.
--   projects.project_commands  the ledger of committed Project commands: Account, command ID, the Project, a hash of the
--                              payload and the original receipt. A receipt is never edited; replaying a command returns
--                              it, and the same command ID with another payload is refused.
--   api.list_projects          the Account's Projects, newest update first (at most 200), with the count of all of them.
--   api.get_project            one Project, or `unavailable`.
--   api.rename_project         the first command: Account, command ID, expected revision, typed payload (the title).
--
-- Every function begins with identity.assert_operation_authority(account, epoch) (Story 1.5): the Account must be active
-- and still under the epoch the request was authorized under. A refusal answers `denied`, and nothing is read or written.
-- That call takes the Account row FOR SHARE until the end of the transaction, so a disable cannot commit between the check
-- and the read or write that follows it.
--
-- A Project that is foreign (another Account's), deleted, unknown or not an ID at all gets the very same answer,
-- `unavailable`, with no field set: the answer cannot be used to find out whether a Project exists. Ownership is part of
-- every query (`account_id = p_account_id`), not a check made afterwards.
--
-- Rename is one transaction. The command ID is serialized first (an advisory lock), then the Project row is locked FOR
-- UPDATE, and only then are the ledger and the revision read, so two windows renaming at once are one commit and one
-- `stale`, and one command sent twice is one commit and one replay:
--   renamed      committed: the title is changed, the revision rose by one, the ledger holds the receipt.
--                `replayed` is true when the receipt is the original of an earlier identical command (nothing changed now).
--   stale        the expected revision is not the Project's current one: nothing changes, no ledger row is written, and the
--                answer carries the current title and revision.
--   reused       the command ID was used before, for another payload: nothing changes.
--   unavailable  the Project is not this Account's, or is deleted or unknown. This holds for a replay too: the Project row is locked
--                (and a deleted one refused) BEFORE the ledger is read, so a command whose Project has since been deleted is
--                `unavailable`, not its original receipt.
--   denied       the Account has no authority for this request.
-- A title that is not valid (not trimmed, empty, over 120 characters, a control character) is not an outcome: it raises 22023
-- like any other invalid argument, because the application checks it first and tells the person in a field error.
--
-- Same pattern as the earlier migrations: both tables are in the unexposed `projects` schema with row-level security on, no
-- policy and every privilege revoked; the functions are in the `api` schema, run as the table owner with an empty
-- search_path, are closed by default (the default-privileges rules of 20261010120000_accounts.sql) and granted to
-- service_role by name at the end. api.preflight is re-created carrying every earlier probe and the new ones.

-- The composite key a Project references -------------------------------------------------------------------------------

alter table projects.workspaces add constraint workspaces_id_account_id_key unique (id, account_id);

-- Projects ---------------------------------------------------------------------------------------------------------------

create table projects.projects (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null,
  account_id uuid not null,
  -- Trimmed (of spaces; the application trims all white space first), 1 to 120 characters, no control characters.
  title text not null check (
    title = btrim(title)
    and char_length(title) between 1 and 120
    and title !~ '[\u0001-\u001f\u007f-\u009f]'
  ),
  stage text not null check (stage in ('researching', 'awaiting_plan_approval', 'generating', 'awaiting_model_approval', 'validation_failed', 'export_ready')),
  -- The Version the Project is at; 0 means it has none yet.
  current_version integer not null default 0 check (current_version >= 0),
  -- Starts at 1 and rises by one with each committed command (projects.guard_project).
  revision bigint not null default 1 check (revision >= 1),
  -- Story 1.8's. 16 random bytes, unique and never changed, returned by no function.
  status_handle bytea not null default extensions.gen_random_bytes(16) check (octet_length(status_handle) = 16),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- Hides the Project from every function here. Nothing sets it in this story.
  deleted_at timestamptz,
  constraint projects_id_account_id_key unique (id, account_id),
  constraint projects_status_handle_key unique (status_handle),
  -- A Project belongs to one Workspace and, through it, to one Account: the pair must be a Workspace of that Account.
  constraint projects_workspace_account_fkey foreign key (workspace_id, account_id) references projects.workspaces (id, account_id) on delete restrict
);

comment on table projects.projects is
  'One row per Project. Reached only through api.list_projects, api.get_project and api.rename_project. The status handle is Story 1.8''s and is returned by no function.';

create index projects_account_updated on projects.projects (account_id, updated_at desc, id) where deleted_at is null;

-- Who a Project is can never change: its ID, its Workspace and Account, its status handle and when it began. Every other
-- change is a committed command, and a committed command raises the revision by exactly one.
create function projects.guard_project() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.id <> old.id or new.workspace_id <> old.workspace_id or new.account_id <> old.account_id
     or new.status_handle <> old.status_handle or new.created_at <> old.created_at then
    raise exception 'a Project cannot change its identity' using errcode = '55000';
  end if;
  if new.revision <> old.revision + 1 then
    raise exception 'a Project''s revision rises by one with each committed command' using errcode = '55000';
  end if;
  return new;
end;
$$;

create trigger projects_guard before update on projects.projects
  for each row execute function projects.guard_project();

-- The ledger -------------------------------------------------------------------------------------------------------------

create table projects.project_commands (
  account_id uuid not null,
  command_id uuid not null,
  project_id uuid not null,
  command text not null check (command in ('rename')),
  -- SHA-256 (hex) of the command's payload: what "the same command" means.
  payload_hash text not null check (payload_hash ~ '^[0-9a-f]{64}$'),
  expected_revision bigint not null check (expected_revision >= 1),
  -- The original receipt: the title the command set and the revision it produced.
  title text not null,
  revision bigint not null check (revision >= 2),
  created_at timestamptz not null default now(),
  primary key (account_id, command_id),
  constraint project_commands_project_fkey foreign key (project_id, account_id) references projects.projects (id, account_id) on delete restrict
);

comment on table projects.project_commands is
  'The committed Project commands, one row each, never edited: replaying a command returns its receipt. Rows leave only with their Project (Story 8.x).';

-- A receipt is never edited (and never emptied in one statement). Deleting one is for the purge that removes its Project.
create function projects.refuse_command_change() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'projects.project_commands is not edited' using errcode = '55000';
end;
$$;

create trigger project_commands_no_update before update on projects.project_commands
  for each row execute function projects.refuse_command_change();
create trigger project_commands_no_truncate before truncate on projects.project_commands
  for each statement execute function projects.refuse_command_change();

-- Closed by default ------------------------------------------------------------------------------------------------------

alter table projects.projects enable row level security;
alter table projects.project_commands enable row level security;
-- No policies on either: only the owner and roles that bypass RLS can read a row, and the privileges below leave anon,
-- authenticated and service_role no path to the tables at all.
revoke all on projects.projects from public, anon, authenticated, service_role;
revoke all on projects.project_commands from public, anon, authenticated, service_role;

-- The functions -----------------------------------------------------------------------------------------------------------

create type api.project_list as (outcome text, total integer, projects jsonb);
create type api.project_view as (outcome text, id uuid, title text, stage text, current_version integer, revision bigint, created_at timestamptz, updated_at timestamptz);
create type api.project_renaming as (outcome text, project_id uuid, title text, revision bigint, replayed boolean);

-- The Account's Projects, newest update first. `total` counts every live Project of the Account; `projects` holds at most
-- p_limit of them (never more than 200) as objects with id, title, stage, current_version, revision, created_at, updated_at.
--   listed | denied
create function api.list_projects(p_account_id uuid, p_epoch bigint, p_limit integer default 200)
returns api.project_list
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_result api.project_list;
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

  -- The count and the list come out of ONE statement, so they are one snapshot and cannot disagree: a Project inserted while this
  -- runs is in both or in neither. (Two statements would each take their own READ COMMITTED snapshot, and the list could then
  -- hold more Projects than the count says.) `count(*) over ()` counts every live Project of the Account before `limit` cuts the list.
  select coalesce(max(r.total), 0)::integer,
         coalesce(jsonb_agg(
           jsonb_build_object(
             'id', r.id, 'title', r.title, 'stage', r.stage, 'current_version', r.current_version,
             'revision', r.revision, 'created_at', r.created_at, 'updated_at', r.updated_at
           ) order by r.updated_at desc, r.id),
         '[]'::jsonb)
    into v_result.total, v_result.projects
    from (
      select p.id, p.title, p.stage, p.current_version, p.revision, p.created_at, p.updated_at, count(*) over () as total
        from projects.projects p
       where p.account_id = p_account_id and p.deleted_at is null
       order by p.updated_at desc, p.id
       limit p_limit
    ) r;

  v_result.outcome := 'listed';
  return v_result;
end;
$$;

comment on function api.list_projects(uuid, bigint, integer) is
  'The Account''s live Projects, newest update first (at most p_limit, never more than 200), and the count of all of them. Begins with identity.assert_operation_authority. listed | denied.';

-- One Project of the Account. A Project that is another Account's, deleted or unknown is `unavailable`, with no field set.
--   found | unavailable | denied
create function api.get_project(p_account_id uuid, p_epoch bigint, p_project_id uuid)
returns api.project_view
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_result api.project_view;
  v_project projects.projects;
begin
  if p_account_id is null or p_epoch is null or p_epoch < 1 or p_project_id is null then
    raise exception 'invalid argument' using errcode = '22023';
  end if;

  begin
    perform identity.assert_operation_authority(p_account_id, p_epoch);
  exception when sqlstate 'N3010' then
    v_result.outcome := 'denied';
    return v_result;
  end;

  select * into v_project
    from projects.projects p
   where p.id = p_project_id and p.account_id = p_account_id and p.deleted_at is null;
  if not found then
    v_result.outcome := 'unavailable';
    return v_result;
  end if;

  v_result.outcome := 'found';
  v_result.id := v_project.id;
  v_result.title := v_project.title;
  v_result.stage := v_project.stage;
  v_result.current_version := v_project.current_version;
  v_result.revision := v_project.revision;
  v_result.created_at := v_project.created_at;
  v_result.updated_at := v_project.updated_at;
  return v_result;
end;
$$;

comment on function api.get_project(uuid, bigint, uuid) is
  'One live Project of the Account. Another Account''s, a deleted and an unknown Project all answer unavailable, with no field set. Begins with identity.assert_operation_authority. found | unavailable | denied.';

-- Rename: Account, command ID, expected revision, typed payload. See the top of this file for the outcomes and the order.
create function api.rename_project(p_account_id uuid, p_epoch bigint, p_command_id uuid, p_project_id uuid, p_expected_revision bigint, p_title text)
returns api.project_renaming
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_result api.project_renaming;
  v_project projects.projects;
  v_command projects.project_commands;
  v_hash text;
begin
  if p_account_id is null or p_epoch is null or p_epoch < 1 or p_command_id is null or p_project_id is null
     or p_expected_revision is null or p_expected_revision < 1
     or p_title is null or p_title <> btrim(p_title) or char_length(p_title) not between 1 and 120
     or p_title ~ '[\u0001-\u001f\u007f-\u009f]' then
    raise exception 'invalid argument' using errcode = '22023';
  end if;

  begin
    perform identity.assert_operation_authority(p_account_id, p_epoch);
  exception when sqlstate 'N3010' then
    v_result.outcome := 'denied';
    return v_result;
  end;

  -- One command ID at a time for an Account, so a command sent twice at once is one commit and one replay.
  perform pg_advisory_xact_lock(hashtextextended('project_command:' || p_account_id::text || ':' || p_command_id::text, 0));

  -- The Project row, locked: a second window waits here and then reads the revision this one committed.
  select * into v_project
    from projects.projects p
   where p.id = p_project_id and p.account_id = p_account_id and p.deleted_at is null
     for update;
  if not found then
    v_result.outcome := 'unavailable';
    return v_result;
  end if;

  v_hash := encode(sha256(convert_to('rename' || E'\n' || p_project_id::text || E'\n' || p_expected_revision::text || E'\n' || p_title, 'UTF8')), 'hex');

  select * into v_command from projects.project_commands c where c.account_id = p_account_id and c.command_id = p_command_id;
  if found then
    if v_command.payload_hash = v_hash then
      -- The Project is live (it was locked above, and a deleted one answered `unavailable` already), so this is its own command's
      -- original receipt, whatever the title is now: no second bump. A receipt does not outlive its Project's visibility.
      v_result.outcome := 'renamed';
      v_result.project_id := v_command.project_id;
      v_result.title := v_command.title;
      v_result.revision := v_command.revision;
      v_result.replayed := true;
    else
      v_result.outcome := 'reused';
    end if;
    return v_result;
  end if;

  if v_project.revision <> p_expected_revision then
    v_result.outcome := 'stale';
    v_result.project_id := v_project.id;
    v_result.title := v_project.title;
    v_result.revision := v_project.revision;
    v_result.replayed := false;
    return v_result;
  end if;

  update projects.projects p
     set title = p_title, revision = p.revision + 1, updated_at = clock_timestamp()
   where p.id = v_project.id
   returning * into v_project;

  insert into projects.project_commands (account_id, command_id, project_id, command, payload_hash, expected_revision, title, revision)
    values (p_account_id, p_command_id, v_project.id, 'rename', v_hash, p_expected_revision, v_project.title, v_project.revision);

  v_result.outcome := 'renamed';
  v_result.project_id := v_project.id;
  v_result.title := v_project.title;
  v_result.revision := v_project.revision;
  v_result.replayed := false;
  return v_result;
end;
$$;

comment on function api.rename_project(uuid, bigint, uuid, uuid, bigint, text) is
  'Renames a live Project of the Account in one transaction under a lock on the Project row, carrying a command ID and the expected revision. renamed (replayed when it is the original receipt of an identical earlier command) | stale (carries the current title and revision; nothing changes, no ledger row) | reused (the command ID was used for another payload) | unavailable | denied. Begins with identity.assert_operation_authority.';

-- The preflight -----------------------------------------------------------------------------------------------------------

-- Everything api.preflight read before (20261012140000_administrator_recovery.sql), plus what this story depends on: the two
-- tables (with the columns the functions use, the status handle included, which is read and discarded here and returned by no
-- function) and the three functions exist and the service role may execute them. It checks the catalog and executes none of
-- them, reads at most one row of each table and writes nothing.
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
  perform 1 from identity.accounts limit 1;
  perform p.account_id, p.locale, p.theme, p.detail, p.guidance, p.created_at, p.updated_at from identity.account_preferences p limit 1;
  perform 1 from identity.step_up_nonces limit 1;
  perform m.session_id, m.nonce_id, m.source from identity.fresh_authentications m limit 1;
  perform t.id, t.account_id, t.token_hash, t.issued_at, t.expires_at, t.used_at, t.voided_at from identity.recovery_tokens t limit 1;
  perform j.id, j.workspace_id, j.account_id, j.title, j.stage, j.current_version, j.revision, j.status_handle, j.created_at, j.updated_at, j.deleted_at from projects.projects j limit 1;
  perform c.account_id, c.command_id, c.project_id, c.command, c.payload_hash, c.expected_revision, c.title, c.revision, c.created_at from projects.project_commands c limit 1;
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
      'api.rename_project(uuid,bigint,uuid,uuid,bigint,text)'
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
  'Reads identity.session_grants (including its CSRF columns), identity.accounts, identity.account_preferences, identity.step_up_nonces, identity.fresh_authentications (including source), identity.recovery_tokens, projects.projects, projects.project_commands, auth.sessions, auth.identities and auth.mfa_amr_claims (one row each at most), checks that the Story 1.5, 1.6 and 1.7 functions exist and are executable by the service role and that the owner may delete from auth.sessions, and answers ok. Read-only.';

-- Access -----------------------------------------------------------------------------------------------------------------

-- Closed by default; only the service role is let in, by name. (create or replace keeps the grant api.preflight already had.)
grant execute on function api.list_projects(uuid, bigint, integer) to service_role;
grant execute on function api.get_project(uuid, bigint, uuid) to service_role;
grant execute on function api.rename_project(uuid, bigint, uuid, uuid, bigint, text) to service_role;

-- New functions and types: have the Data API reload its schema cache now.
notify pgrst, 'reload schema';
