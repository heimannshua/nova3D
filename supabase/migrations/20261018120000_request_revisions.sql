-- Story 2.1: confirm natural-language intent and personalization.
--
-- Projects owns the request revision: what a person confirmed they want, recorded exactly, so that research and generation can later be
-- held to it. Confirming a request starts nothing, approves nothing and spends nothing: a revision carries no approval, no permission and
-- no payment field, and the Project it creates is in the new stage `request_confirmed`.
--
--   projects.request_revisions   the immutable revision family: one row per confirmed request, `seq` 1 for the first. A Project is born
--                                together with its revision 1 (nothing is stored before Confirm, so an abandoned draft leaves no
--                                trace and no Project is ever in a stage that is not true). The revision doubles as the command
--                                receipt: `command_id` is unique per Account and `digest` is what "the same command" means.
--   api.create_project_request   the one idempotent command that creates the Project and its first revision at confirmation.
--   projects.is_invisible and    the two text checks the table and the command share: a text that draws nothing (empty, or only control,
--   projects.has_bidi_control    format, separator and fill characters) and a text that holds a bidirectional override, embedding or
--                                isolate control (U+202A to U+202E, U+2066 to U+2069). lib/request-intake.ts makes the same two checks.
--   api.read_project_request     the latest revision of a Project, for its page.
--
-- The stage check of projects.projects gains `request_confirmed` (the first stage of a Project's life, before research).
--
-- A revision is never updated and the table never truncated. Deleting is left to the Epic 8 purge, so the foreign key to the Project
-- restricts and the cleanup helpers of the tests delete revisions first. Later stories (2.2, 2.3, 2.12, 2.13) append SUCCESSOR revisions
-- with `seq` + 1 to an existing Project; a writer that does must hold the Project row FOR SHARE or FOR UPDATE, call
-- lifecycle.assert_not_tombstoned('project', id) and raise the Project's revision by exactly one (docs/authority-contract.md).
--
-- The database cannot know the registry of domain packages (lib/domain-registry.ts): it checks that a subject ID is shaped like one, and
-- the application, which validates the subject against the registry, is the only caller.
--
-- Same pattern as the earlier migrations: the table is in the unexposed `projects` schema with row-level security on, no policy and every
-- privilege revoked; the functions are in the `api` schema, run as the table owner with an empty search_path, are closed by default (the
-- default-privileges rules of 20261010120000_accounts.sql) and are granted to service_role by name at the end. api.preflight is re-created
-- carrying every earlier probe and the new ones.
--
-- create_project_request, in order (the order of api.rename_project):
--   1. the arguments are checked: a shape the application would never send raises 22023 (invalid argument), like any other invalid argument
--   2. identity.assert_operation_authority(account, epoch): a refusal (N3010: disabled, stale epoch, tombstoned, unknown) answers `denied`
--   3. the command ID is serialized (an advisory lock on 'project_command:'||account||':'||command: the lock api.rename_project takes too,
--      so a rename and a creation of one command ID are never in flight together)
--   4. a command ID that a rename already used is `reused`. (Only this direction is refused: Story 1.7's rename is unchanged and does
--      not look at request revisions, so a rename that reuses a creation's command ID is not refused.)
--   5. a command ID that a revision already used: the same digest replays the original receipt (`replayed`) while its Project is live, and
--      is `unavailable` once the Project is deleted or tombstoned (a receipt does not outlive its Project's visibility, as in rename);
--      another digest is `reused`
--   6. otherwise ONE transaction creates the Project (title, stage `request_confirmed`, revision 1, in the Account's Workspace) and its
--      request revision 1, and answers `created` with both IDs
--
-- read_project_request: `denied` | `unavailable` (unknown, another Account's, deleted or tombstoned: ONE answer with nothing in it) |
-- `none` (a Project without a revision) | `found` with the latest revision's fields.

-- Text that draws nothing, and bidirectional controls ---------------------------------------------------------------------------------

-- True for a text with no visible character: empty, or made only of control (Cc), format (Cf, zero-width space and joiners included),
-- separator (Z) and fill characters (U+2800, U+3164, U+115F, U+1160). It is the class lib/request-intake.ts removes (`\p{Cc}\p{Cf}\p{Z}` and
-- those four), written out because a Postgres regular expression has no Unicode properties; tests/integration/request-revisions.test.ts holds
-- the two equal over every code point. U+200C and U+200D are in the class, so a text of only joiners draws nothing, but a joiner between
-- letters (Hebrew, Persian, emoji) does not make the text invisible: the test is on the whole text.
create function projects.is_invisible(p_value text) returns boolean
language sql
immutable
set search_path = ''
as $$
  select p_value ~ '^[\u0001-\u0020\u007f-\u00a0\u00ad\u0600-\u0605\u061c\u06dd\u070f\u0890-\u0891\u08e2\u115f-\u1160\u1680\u180e\u2000-\u200f\u2028-\u202f\u205f-\u2064\u2066-\u206f\u2800\u3000\u3164\ufeff\ufff9-\ufffb\U000110bd\U000110cd\U00013430-\U0001343f\U0001bca0-\U0001bca3\U0001d173-\U0001d17a\U000e0001\U000e0020-\U000e007f]*$'
$$;

-- True for a text that holds a bidirectional override, embedding or isolate control, which can make text read in an order other than the
-- one it is stored in.
create function projects.has_bidi_control(p_value text) returns boolean
language sql
immutable
set search_path = ''
as $$
  select p_value ~ '[\u202a-\u202e\u2066-\u2069]'
$$;

-- The stage vocabulary ----------------------------------------------------------------------------------------------------------------

alter table projects.projects drop constraint projects_stage_check;
alter table projects.projects add constraint projects_stage_check check (
  stage in ('request_confirmed', 'researching', 'awaiting_plan_approval', 'generating', 'awaiting_model_approval', 'validation_failed', 'export_ready')
);

-- Request revisions -------------------------------------------------------------------------------------------------------------------

create table projects.request_revisions (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null,
  account_id uuid not null,
  -- 1 for the first revision of a Project; a successor is seq + 1.
  seq integer not null check (seq >= 1),
  -- The command that made it, unique per Account: the revision is its own receipt.
  command_id uuid not null,
  mode text not null check (mode in ('evidence_text', 'evidence_images', 'image_direct')),
  -- A subject of a domain package (lib/domain-registry.ts); the database checks only its shape. Required for a text request.
  subject_id text check (subject_id ~ '^[a-z][a-z0-9-]{0,62}$'),
  -- What the person confirmed, in their own words: free text, trimmed, never altered after it was confirmed.
  scope text not null check (
    scope = btrim(scope) and char_length(scope) between 1 and 300 and scope !~ '[\u0001-\u001f\u007f-\u009f]'
    and not projects.is_invisible(scope) and not projects.has_bidi_control(scope)
  ),
  outcome text not null check (
    outcome = btrim(outcome) and char_length(outcome) between 1 and 300 and outcome !~ '[\u0001-\u001f\u007f-\u009f]'
    and not projects.is_invisible(outcome) and not projects.has_bidi_control(outcome)
  ),
  description text not null check (
    description = btrim(description, E' \t\n') and char_length(description) between 1 and 2000 and description !~ '[\u0001-\u0008\u000b-\u001f\u007f-\u009f]'
    and not projects.is_invisible(description) and not projects.has_bidi_control(description)
  ),
  -- The personalization wish as written, and what it was understood as. One kind is supported: raised or recessed text.
  personalization_wording text check (
    personalization_wording = btrim(personalization_wording, E' \t\n') and char_length(personalization_wording) between 1 and 300
    and personalization_wording !~ '[\u0001-\u0008\u000b-\u001f\u007f-\u009f]'
    and not projects.is_invisible(personalization_wording) and not projects.has_bidi_control(personalization_wording)
  ),
  personalization_text text check (
    personalization_text = btrim(personalization_text) and char_length(personalization_text) between 1 and 24 and personalization_text !~ '[\u0001-\u001f\u007f-\u009f]'
    and not projects.is_invisible(personalization_text) and not projects.has_bidi_control(personalization_text)
  ),
  personalization_style text check (personalization_style in ('raised', 'recessed')),
  personalization_applied boolean not null,
  personalization_reason text check (
    personalization_reason in ('no_quoted_text', 'several_texts', 'text_too_long', 'text_invalid', 'conflicting_styles', 'image_direct_has_no_surfaces')
  ),
  -- SHA-256 (hex) over the length-prefixed fields of the command, the Project's title included: what "the same command" means.
  digest text not null check (digest ~ '^[0-9a-f]{64}$'),
  confirmed_at timestamptz not null,
  created_at timestamptz not null default now(),
  constraint request_revisions_project_fkey foreign key (project_id, account_id) references projects.projects (id, account_id) on delete restrict,
  constraint request_revisions_seq_key unique (project_id, seq),
  constraint request_revisions_command_key unique (account_id, command_id),
  constraint request_revisions_subject_required check (mode <> 'evidence_text' or subject_id is not null),
  -- An applied wish has its wording, its text and its style, and the mode has surfaces to put it on (an image-derived model has none).
  constraint request_revisions_applied_shape check (
    not personalization_applied
    or (personalization_wording is not null and personalization_text is not null and personalization_style is not null and mode <> 'image_direct')
  ),
  -- A wish that is not applied (or no wish at all) has no text and no style.
  constraint request_revisions_not_applied_shape check (personalization_applied or (personalization_text is null and personalization_style is null)),
  -- A reason is present exactly when there is a wording and it was not applied.
  constraint request_revisions_reason_shape check ((personalization_reason is not null) = (personalization_wording is not null and not personalization_applied))
);

comment on table projects.request_revisions is
  'The immutable request revisions of Projects, one row each, never edited (seq 1 is created with the Project). Reached only through api.create_project_request and api.read_project_request. Rows leave only with their Project (Story 8.x).';

-- A revision is never edited (and never emptied in one statement). Deleting one is for the purge that removes its Project.
create function projects.refuse_revision_change() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'projects.request_revisions is not edited' using errcode = '55000';
end;
$$;

create trigger request_revisions_no_update before update on projects.request_revisions
  for each row execute function projects.refuse_revision_change();
create trigger request_revisions_no_truncate before truncate on projects.request_revisions
  for each statement execute function projects.refuse_revision_change();

-- Closed by default -------------------------------------------------------------------------------------------------------------------

alter table projects.request_revisions enable row level security;
-- No policy: only the owner and roles that bypass RLS can read a row, and the privileges below leave anon, authenticated and
-- service_role no path to the table at all.
revoke all on projects.request_revisions from public, anon, authenticated, service_role;

-- The digest --------------------------------------------------------------------------------------------------------------------------

-- A field as the digest takes it: its length in bytes, a colon, then the field; an absent field is a dash (a present one always starts
-- with a digit, so the two cannot be confused). Fields that are length-prefixed need no separator and cannot run into one another.
-- octet_length of a text is its length in the database encoding, which is UTF8 (the bytes convert_to(.., 'UTF8') would count), and the
-- function stays truly immutable, which convert_to, being stable, would not let it be.
create function projects.length_prefixed(p_value text) returns text
language sql
immutable
set search_path = ''
as $$
  select case when p_value is null then '-' else octet_length(p_value)::text || ':' || p_value end
$$;

-- The functions -----------------------------------------------------------------------------------------------------------------------

create type api.request_creation as (outcome text, project_id uuid, request_id uuid);
create type api.project_request_view as (
  outcome text,
  request_id uuid,
  project_id uuid,
  seq integer,
  mode text,
  subject_id text,
  scope text,
  -- The request's own `outcome` (what the person wants to come of it); `outcome` above is the answer.
  intended_outcome text,
  description text,
  personalization_wording text,
  personalization_text text,
  personalization_style text,
  personalization_applied boolean,
  personalization_reason text,
  confirmed_at timestamptz
);

-- Creates a Project and its first request revision at confirmation. See the top of this file for the outcomes and the order.
--   created | replayed | reused | unavailable | denied
create function api.create_project_request(
  p_account_id uuid,
  p_epoch bigint,
  p_command_id uuid,
  p_title text,
  p_mode text,
  p_subject_id text,
  p_scope text,
  p_outcome text,
  p_description text,
  p_personalization_wording text,
  p_personalization_text text,
  p_personalization_style text,
  p_personalization_applied boolean,
  p_personalization_reason text
)
returns api.request_creation
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_result api.request_creation;
  v_existing projects.request_revisions;
  v_workspace_id uuid;
  v_project_id uuid;
  v_request_id uuid;
  v_digest text;
  v_now timestamptz;
begin
  -- 1. The arguments: the same rules as the Project title and the table's checks, so a shape the application would never send is refused
  -- here, with a code, and the table's own checks are the second line.
  if p_account_id is null or p_epoch is null or p_epoch < 1 or p_command_id is null
     or p_title is null or p_title <> btrim(p_title) or char_length(p_title) not between 1 and 120 or p_title ~ '[\u0001-\u001f\u007f-\u009f]'
     or p_mode is null or p_mode not in ('evidence_text', 'evidence_images', 'image_direct')
     or (p_subject_id is not null and p_subject_id !~ '^[a-z][a-z0-9-]{0,62}$')
     or (p_mode = 'evidence_text' and p_subject_id is null)
     or p_scope is null or p_scope <> btrim(p_scope) or char_length(p_scope) not between 1 and 300 or p_scope ~ '[\u0001-\u001f\u007f-\u009f]'
     or projects.is_invisible(p_scope) or projects.has_bidi_control(p_scope)
     or p_outcome is null or p_outcome <> btrim(p_outcome) or char_length(p_outcome) not between 1 and 300 or p_outcome ~ '[\u0001-\u001f\u007f-\u009f]'
     or projects.is_invisible(p_outcome) or projects.has_bidi_control(p_outcome)
     or p_description is null or p_description <> btrim(p_description, E' \t\n') or char_length(p_description) not between 1 and 2000
     or p_description ~ '[\u0001-\u0008\u000b-\u001f\u007f-\u009f]'
     or projects.is_invisible(p_description) or projects.has_bidi_control(p_description)
     or (p_personalization_wording is not null and (
           p_personalization_wording <> btrim(p_personalization_wording, E' \t\n') or char_length(p_personalization_wording) not between 1 and 300
           or p_personalization_wording ~ '[\u0001-\u0008\u000b-\u001f\u007f-\u009f]'
           or projects.is_invisible(p_personalization_wording) or projects.has_bidi_control(p_personalization_wording)))
     or (p_personalization_text is not null and (
           p_personalization_text <> btrim(p_personalization_text) or char_length(p_personalization_text) not between 1 and 24
           or p_personalization_text ~ '[\u0001-\u001f\u007f-\u009f]'
           or projects.is_invisible(p_personalization_text) or projects.has_bidi_control(p_personalization_text)))
     or (p_personalization_style is not null and p_personalization_style not in ('raised', 'recessed'))
     or p_personalization_applied is null
     or (p_personalization_reason is not null and p_personalization_reason not in
           ('no_quoted_text', 'several_texts', 'text_too_long', 'text_invalid', 'conflicting_styles', 'image_direct_has_no_surfaces'))
     -- applied: wording, text and style are all set and the mode has surfaces; not applied: no text and no style; a reason exactly when
     -- there is a wording that was not applied
     or (p_personalization_applied and (p_personalization_wording is null or p_personalization_text is null or p_personalization_style is null or p_mode = 'image_direct'))
     or (not p_personalization_applied and (p_personalization_text is not null or p_personalization_style is not null))
     or ((p_personalization_reason is not null) <> (p_personalization_wording is not null and not p_personalization_applied)) then
    raise exception 'invalid argument' using errcode = '22023';
  end if;

  -- 2. Authority, before anything is read or written.
  begin
    perform identity.assert_operation_authority(p_account_id, p_epoch);
  exception when sqlstate 'N3010' then
    v_result.outcome := 'denied';
    return v_result;
  end;

  -- 3. One command ID at a time for an Account, so a command sent twice at once is one commit and one replay.
  perform pg_advisory_xact_lock(hashtextextended('project_command:' || p_account_id::text || ':' || p_command_id::text, 0));

  -- 4. A command ID a rename already used is not a creation, whatever else is the same.
  if exists (select 1 from projects.project_commands c where c.account_id = p_account_id and c.command_id = p_command_id) then
    v_result.outcome := 'reused';
    return v_result;
  end if;

  v_digest := encode(sha256(convert_to(
    'create_project_request' || E'\n'
    || projects.length_prefixed(p_title)
    || projects.length_prefixed(p_mode)
    || projects.length_prefixed(p_subject_id)
    || projects.length_prefixed(p_scope)
    || projects.length_prefixed(p_outcome)
    || projects.length_prefixed(p_description)
    || projects.length_prefixed(p_personalization_wording)
    || projects.length_prefixed(p_personalization_text)
    || projects.length_prefixed(p_personalization_style)
    || projects.length_prefixed(p_personalization_applied::text)
    || projects.length_prefixed(p_personalization_reason),
    'UTF8')), 'hex');

  -- 5. The revision is the receipt: the same command with the same digest is the original answer while its Project is live, another digest
  -- is a reused ID. A receipt does not outlive its Project's visibility (as in api.rename_project): once the Project is deleted or
  -- tombstoned the replay is `unavailable`, with no ID, so Confirm does not send the person to a Project that is not there.
  select * into v_existing from projects.request_revisions r where r.account_id = p_account_id and r.command_id = p_command_id;
  if found then
    if v_existing.digest <> v_digest then
      v_result.outcome := 'reused';
      return v_result;
    end if;
    perform 1
      from projects.projects p
     where p.id = v_existing.project_id and p.account_id = p_account_id and p.deleted_at is null
       and not lifecycle.is_tombstoned('project', p.id);
    if not found then
      v_result.outcome := 'unavailable';
      return v_result;
    end if;
    v_result.outcome := 'replayed';
    v_result.project_id := v_existing.project_id;
    v_result.request_id := v_existing.id;
    return v_result;
  end if;

  -- 6. The Project and its revision 1, together.
  select w.id into v_workspace_id from projects.workspaces w where w.account_id = p_account_id;
  if not found then
    raise exception 'the Account has no Workspace' using errcode = '55000';
  end if;

  v_now := clock_timestamp();
  insert into projects.projects (workspace_id, account_id, title, stage, created_at, updated_at)
    values (v_workspace_id, p_account_id, p_title, 'request_confirmed', v_now, v_now)
    returning id into v_project_id;

  insert into projects.request_revisions (
    project_id, account_id, seq, command_id, mode, subject_id, scope, outcome, description,
    personalization_wording, personalization_text, personalization_style, personalization_applied, personalization_reason,
    digest, confirmed_at, created_at
  ) values (
    v_project_id, p_account_id, 1, p_command_id, p_mode, p_subject_id, p_scope, p_outcome, p_description,
    p_personalization_wording, p_personalization_text, p_personalization_style, p_personalization_applied, p_personalization_reason,
    v_digest, v_now, v_now
  ) returning id into v_request_id;

  v_result.outcome := 'created';
  v_result.project_id := v_project_id;
  v_result.request_id := v_request_id;
  return v_result;
end;
$$;

comment on function api.create_project_request(uuid, bigint, uuid, text, text, text, text, text, text, text, text, text, boolean, text) is
  'Creates a Project (stage request_confirmed, revision 1, in the Account''s Workspace) and its request revision 1 in one transaction. The revision is the command receipt: created | replayed (the same command ID and digest: the original IDs, while the Project is live) | reused (the command ID was used by a rename, or by another digest) | unavailable (a replay whose Project has since been deleted or tombstoned) | denied. Begins, after its argument checks (22023), with identity.assert_operation_authority.';

-- The latest request revision of a Project of the Account. Another Account's, deleted, tombstoned and unknown Projects are ONE answer.
--   found | none | unavailable | denied
create function api.read_project_request(p_account_id uuid, p_epoch bigint, p_project_id uuid)
returns api.project_request_view
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_result api.project_request_view;
  v_revision projects.request_revisions;
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

  perform 1
    from projects.projects p
   where p.id = p_project_id and p.account_id = p_account_id and p.deleted_at is null
     and not lifecycle.is_tombstoned('project', p.id);
  if not found then
    v_result.outcome := 'unavailable';
    return v_result;
  end if;

  select * into v_revision
    from projects.request_revisions r
   where r.project_id = p_project_id and r.account_id = p_account_id
   order by r.seq desc
   limit 1;
  if not found then
    v_result.outcome := 'none';
    return v_result;
  end if;

  v_result.outcome := 'found';
  v_result.request_id := v_revision.id;
  v_result.project_id := v_revision.project_id;
  v_result.seq := v_revision.seq;
  v_result.mode := v_revision.mode;
  v_result.subject_id := v_revision.subject_id;
  v_result.scope := v_revision.scope;
  v_result.intended_outcome := v_revision.outcome;
  v_result.description := v_revision.description;
  v_result.personalization_wording := v_revision.personalization_wording;
  v_result.personalization_text := v_revision.personalization_text;
  v_result.personalization_style := v_revision.personalization_style;
  v_result.personalization_applied := v_revision.personalization_applied;
  v_result.personalization_reason := v_revision.personalization_reason;
  v_result.confirmed_at := v_revision.confirmed_at;
  return v_result;
end;
$$;

comment on function api.read_project_request(uuid, bigint, uuid) is
  'The latest request revision of a live Project of the Account. found (with the revision''s fields) | none (a Project without a revision) | unavailable (another Account''s, deleted, tombstoned and unknown Projects, one answer with nothing in it) | denied. Begins with identity.assert_operation_authority.';

-- The preflight -----------------------------------------------------------------------------------------------------------------------

-- Everything api.preflight read before (20261016120000_alarms.sql), plus what this story depends on: projects.request_revisions (with the
-- columns the functions use) and the two functions exist and the service role may execute them (thirty-three `api` functions in all). It
-- checks the catalog and executes none of them, reads at most one row of each table and writes nothing. The bucket check stays last.
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
  perform q.id, q.project_id, q.account_id, q.seq, q.command_id, q.mode, q.subject_id, q.scope, q.outcome, q.description, q.personalization_wording, q.personalization_text, q.personalization_style, q.personalization_applied, q.personalization_reason, q.digest, q.confirmed_at, q.created_at from projects.request_revisions q limit 1;
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
      'api.create_project_request(uuid,bigint,uuid,text,text,text,text,text,text,text,text,text,boolean,text)',
      'api.read_project_request(uuid,bigint,uuid)'
    ]) as f(signature)
   where to_regprocedure(f.signature) is null;
  if v_missing is not null then
    raise exception 'api.preflight: the Story 2.1 migration is not applied (missing %)', v_missing using errcode = 'N3020';
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
      'api.read_project_request(uuid,bigint,uuid)'
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
  'Reads identity.session_grants (including its CSRF columns), identity.accounts (including its status handle), identity.account_preferences, identity.step_up_nonces, identity.fresh_authentications (including source), identity.recovery_tokens, projects.projects, projects.project_commands, projects.request_revisions, lifecycle.tombstones, lifecycle.ledger_outbox, lifecycle.ledger_relay, lifecycle.status_requests, lifecycle.job_receipts, the six artifacts tables and the artifacts.session_authority and artifacts.instance views, lifecycle.alarms, lifecycle.alarm_notices, lifecycle.heartbeats, auth.sessions, auth.identities and auth.mfa_amr_claims (one row each at most), checks that the Story 1.5, 1.6, 1.7, 1.8, 1.9, 1.12, 1.13 and 2.1 functions exist and are executable by the service role, that the private-files bucket exists and is private, and that the owner may delete from auth.sessions and auth.users, and answers ok. Read-only.';

-- Access ------------------------------------------------------------------------------------------------------------------------------

-- Closed by default; only the service role is let in, by name. projects.length_prefixed is granted to nobody: SQL that runs as the owner
-- calls it. (create or replace keeps the grants api.preflight already had.)
grant execute on function api.create_project_request(uuid, bigint, uuid, text, text, text, text, text, text, text, text, text, boolean, text) to service_role;
grant execute on function api.read_project_request(uuid, bigint, uuid) to service_role;

-- New functions and types: have the Data API reload its schema cache now.
notify pgrst, 'reload schema';
