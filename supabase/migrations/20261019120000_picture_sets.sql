-- Story 2.2: stage ordered multi-view images privately.
--
-- A person starts from pictures: they choose or photograph several views of one subject, order them, and keep them privately. The bytes never
-- pass through the application (the browser sends each picture to the file gateway of Story 1.12 with a single-use ticket); what the application
-- records is WHICH pictures, in WHICH order, as an immutable request revision of a Project. Nothing is chosen, researched, retained or confirmed
-- by this story: picking how the pictures are used, the quality checks, retaining a copy and confirming the request are Stories 2.3, 2.12 and 2.13.
--
--   projects.request_revisions    gains the UNCONFIRMED state: `confirmed_at`, `description`, `scope` and `outcome` may be null, together and only
--                                 together (an unconfirmed revision claims nothing about scope), and a text request (`evidence_text`) still requires
--                                 them. A picture revision made here has them null, no subject, no personalization (`personalization_applied` false)
--                                 and the PROVISIONAL mode `evidence_images`, which no screen presents as a choice (Story 2.3 records the explicit
--                                 choice as a successor revision).
--   projects.request_images       the ordered pictures of a revision, one row each: the position (1 to 12), the upload ID, and the SHA-256, length
--                                 and content type READ FROM THE UPLOAD'S LEASE (never from the browser). Closed like request_revisions, never
--                                 updated or truncated; rows leave only with their revision (the Epic 8 purge), so the foreign keys restrict.
--   projects.check_revision_seq   a revision's `seq` is exactly the Project's highest `seq` plus one (1 for the first).
--   projects.projects             the stage check gains `request_draft`: pictures are saved, nothing else has happened.
--   api.record_picture_set        the ONE writer of a picture revision (and of the Project the first one is born with): idempotent by command ID,
--                                 reads each upload from its lease, enforces the limits, renews the leases within a bound and releases the uploads
--                                 that left the set.
--   api.release_staged_pictures   releases the Account's own picture uploads that no revision uses (a replaced or removed picture that was never saved).
--   api.read_project_request      now also answers `confirmed` and `images`, for the latest revision.
--   api.rename_project            now refuses a command ID that a revision used (`reused`): the lock Story 2.1 left one-directional is closed.
--   api.preflight                 re-created carrying every earlier probe and the new ones.
--
-- record_picture_set, in order (the order of api.create_project_request):
--   1. the arguments are checked: 1 to 12 upload IDs, none repeated, none null; a title exactly when the Project is created. A shape the application
--      would never send raises 22023.
--   2. identity.assert_operation_authority(account, epoch): a refusal (N3010) answers `denied` and writes nothing
--   3. the command ID is serialized (the advisory lock 'project_command:'||account||':'||command that rename and create take)
--   4. a command ID that a rename used is `reused`
--   5. a command ID that a revision used: the same digest replays the original receipt (`replayed`) while its Project is live and is `unavailable`
--      once the Project is deleted or tombstoned; another digest is `reused`. The digest is SHA-256 over the length-prefixed fields: the project as
--      the caller named it (absent when creating), then for each position: the position, the upload, its SHA-256, its length and its content type.
--   6. for an existing Project: its row is locked FOR UPDATE with the Account's own, `deleted_at is null` and no tombstone (`unavailable`: another
--      Account's, deleted, tombstoned and unknown Projects are ONE answer), and its latest revision is an unconfirmed picture revision (`not_editable`
--      otherwise: a text request, a confirmed revision, a Project without a revision)
--   7. every upload is read from artifacts.staging_leases, in position order, as the owner: another Account's, unknown or not a picture is
--      `unknown_upload`, one that is not `complete` is `not_ready`, one past its expiry is `expired_upload`, and one whose SHA-256 (the lease's, never
--      the browser's) is the same as an EARLIER position's is `duplicate_image` (each with its position). The positions are examined in order and each
--      position's checks run in the order just named, so the FIRST problem by position wins: a picture that is also a duplicate answers for the
--      problem of its own lease first, and a duplicate at position 2 is told before an expired lease at position 3. The same upload ID twice is not
--      this: it is an argument error (step 1); this is two DIFFERENT uploads holding the same bytes.
--   8. the lengths add up to more than 60 MiB: `too_large`
--   9. the same ordered uploads as the latest revision: `unchanged`. Nothing is recorded (no revision, no change to the Project, nothing released), but
--      the included leases are renewed, within the bound of step 10, so pressing Save on a set that has not changed is how it is kept for another 24 hours
--  10. otherwise ONE transaction inserts the Project at revision 1 with the stage `request_draft` (creating) or raises its revision by exactly one and
--      sets `updated_at` (a successor), inserts the revision and its images, sets each included lease's `expires_at` to the EARLIER of 24 hours from the
--      database clock and 7 days after the lease was created (so a lease can be kept for a week at most), and releases every lease the previous revision
--      used that the new set does not and no other Project's latest revision still uses. A released lease no longer counts toward the quota, and the
--      hourly cleanup of Story 1.12 removes its staging object.
--
-- A lease keeps `sha256`, `length` and `content_type` for ever (a row is never deleted), so the digest of a command can be recomputed after the
-- uploads are released or expired.

-- The stage vocabulary ----------------------------------------------------------------------------------------------------------------------

alter table projects.projects drop constraint projects_stage_check;
alter table projects.projects add constraint projects_stage_check check (
  stage in ('request_draft', 'request_confirmed', 'researching', 'awaiting_plan_approval', 'generating', 'awaiting_model_approval', 'validation_failed', 'export_ready')
);

-- Unconfirmed revisions ---------------------------------------------------------------------------------------------------------------------

alter table projects.request_revisions alter column confirmed_at drop not null;
alter table projects.request_revisions alter column description drop not null;
alter table projects.request_revisions alter column scope drop not null;
alter table projects.request_revisions alter column outcome drop not null;

-- What the person confirmed is all there or all absent: a revision is either confirmed (a time, a description, a scope and an outcome) or it claims
-- none of them. (The column checks of 20261018120000_request_revisions.sql still bind a value that is present.)
alter table projects.request_revisions add constraint request_revisions_confirmed_shape check (
  (confirmed_at is null) = (description is null) and (confirmed_at is null) = (scope is null) and (confirmed_at is null) = (outcome is null)
);
-- A text request is always confirmed: it is created at confirmation (Story 2.1).
alter table projects.request_revisions add constraint request_revisions_text_confirmed check (mode <> 'evidence_text' or confirmed_at is not null);
-- An unconfirmed revision says nothing about a subject or a wish.
alter table projects.request_revisions add constraint request_revisions_unconfirmed_shape check (
  confirmed_at is not null
  or (subject_id is null and personalization_wording is null and personalization_text is null and personalization_style is null
      and not personalization_applied and personalization_reason is null)
);

-- A revision's number is the Project's highest plus one. The Project's row is locked by every writer, so two writers do not race; the unique key on
-- (project_id, seq) is the second line. (Story 2.1 left the number to the writer; a gap or a repeat is refused here, whoever inserts.)
create function projects.check_revision_seq() returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_next integer;
begin
  select coalesce(max(r.seq), 0) + 1 into v_next from projects.request_revisions r where r.project_id = new.project_id;
  if new.seq is distinct from v_next then
    raise exception 'a revision''s seq is the Project''s highest seq plus one (%)', v_next using errcode = '23514';
  end if;
  return new;
end;
$$;

create trigger request_revisions_seq before insert on projects.request_revisions
  for each row execute function projects.check_revision_seq();

-- The composite key the pictures of a revision reference, so a picture can never name another Project's or Account's revision.
alter table projects.request_revisions add constraint request_revisions_id_project_key unique (id, project_id, account_id);

-- The pictures of a revision -----------------------------------------------------------------------------------------------------------------

create table projects.request_images (
  revision_id uuid not null,
  project_id uuid not null,
  account_id uuid not null,
  -- 1 is the first angle. The position is the person's order.
  position integer not null check (position between 1 and 12),
  -- The upload (artifacts.staging_leases.id) the picture is. The lease, not the browser, says what it is: the three values below are copied from it.
  upload_id uuid not null,
  sha256 text not null check (sha256 ~ '^[0-9a-f]{64}$'),
  length bigint not null check (length >= 1 and length <= 12582912),
  content_type text not null check (content_type in ('image/jpeg', 'image/png', 'image/webp')),
  primary key (revision_id, position),
  constraint request_images_upload_key unique (revision_id, upload_id),
  constraint request_images_revision_fkey foreign key (revision_id, project_id, account_id)
    references projects.request_revisions (id, project_id, account_id) on delete restrict,
  constraint request_images_project_fkey foreign key (project_id, account_id) references projects.projects (id, account_id) on delete restrict
);

comment on table projects.request_images is
  'The ordered pictures of a request revision: position, upload ID and the SHA-256, length and content type read from the upload''s lease. Never edited; rows leave only with their revision (Story 8.x). Reached only through api.record_picture_set and api.read_project_request.';

-- "Does any revision use this upload?" (api.release_staged_pictures) and "which Projects use it?" (api.record_picture_set).
create index request_images_upload on projects.request_images (account_id, upload_id);

create function projects.refuse_image_change() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'projects.request_images is not edited' using errcode = '55000';
end;
$$;

create trigger request_images_no_update before update on projects.request_images
  for each row execute function projects.refuse_image_change();
create trigger request_images_no_truncate before truncate on projects.request_images
  for each statement execute function projects.refuse_image_change();

alter table projects.request_images enable row level security;
-- No policy: closed like projects.request_revisions.
revoke all on projects.request_images from public, anon, authenticated, service_role;

-- The digest of a picture set ---------------------------------------------------------------------------------------------------------------

-- SHA-256 (hex) over the command's length-prefixed fields (projects.length_prefixed): the project as the caller named it (absent when creating), then for each
-- position the position, the upload, and the SHA-256, length and content type of the upload's lease. Null when any upload is not the Account's own
-- picture lease: such a set cannot be the one a revision recorded. It reads leases of any state (a lease row is never deleted), so a replay is
-- recognised after the uploads were released or expired. Granted to nobody: SQL that runs as the owner calls it.
create function projects.picture_set_digest(p_account_id uuid, p_project_id uuid, p_upload_ids uuid[]) returns text
language sql
stable
set search_path = ''
as $$
  select case when count(l.id) = cardinality(p_upload_ids) then
    encode(sha256(convert_to(
      'record_picture_set' || E'\n' || projects.length_prefixed(p_project_id::text)
      || string_agg(
           projects.length_prefixed(u.position::text) || projects.length_prefixed(p_upload_ids[u.position]::text) || projects.length_prefixed(l.sha256)
           || projects.length_prefixed(l.length::text) || projects.length_prefixed(l.content_type),
           '' order by u.position),
      'UTF8')), 'hex')
  end
  from generate_series(1, cardinality(p_upload_ids)) as u(position)
  left join artifacts.staging_leases l on l.id = p_upload_ids[u.position] and l.account_id = p_account_id and l.kind = 'picture'
$$;

-- Recording a picture set -------------------------------------------------------------------------------------------------------------------

-- `position` is the one the answer is about (unknown_upload, not_ready, expired_upload); `released` counts the uploads a successor released.
create type api.picture_set_recording as (outcome text, project_id uuid, request_id uuid, seq integer, position integer, released integer);

-- Creates the Project and its first picture revision (p_project_id null), or appends a successor to an unconfirmed picture Project. See the top of this
-- file for the outcomes and the order.
--   created | revised | unchanged | replayed | reused | unavailable | not_editable | unknown_upload | not_ready | expired_upload | duplicate_image | too_large | denied
create function api.record_picture_set(p_account_id uuid, p_epoch bigint, p_command_id uuid, p_project_id uuid, p_title text, p_upload_ids uuid[])
returns api.picture_set_recording
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_result api.picture_set_recording;
  v_existing projects.request_revisions;
  v_latest projects.request_revisions;
  v_workspace_id uuid;
  v_project_id uuid;
  v_request_id uuid;
  v_seq integer;
  v_digest text;
  v_now timestamptz;
  v_row record;
  v_total bigint := 0;
  v_seen text[] := '{}';
  v_current uuid[];
begin
  -- 1. The arguments.
  if p_account_id is null or p_epoch is null or p_epoch < 1 or p_command_id is null
     or p_upload_ids is null or array_ndims(p_upload_ids) is distinct from 1 or array_lower(p_upload_ids, 1) <> 1
     or cardinality(p_upload_ids) not between 1 and 12
     or array_position(p_upload_ids, null) is not null
     or (select count(distinct x.id) from unnest(p_upload_ids) as x(id)) <> cardinality(p_upload_ids)
     or (p_project_id is null and (p_title is null or p_title <> btrim(p_title) or char_length(p_title) not between 1 and 120 or p_title ~ '[\u0001-\u001f\u007f-\u009f]'))
     or (p_project_id is not null and p_title is not null) then
    raise exception 'invalid argument' using errcode = '22023';
  end if;

  -- 2. Authority, before anything is read or written.
  begin
    perform identity.assert_operation_authority(p_account_id, p_epoch);
  exception when sqlstate 'N3010' then
    v_result.outcome := 'denied';
    return v_result;
  end;

  -- 3. One command ID at a time for an Account.
  perform pg_advisory_xact_lock(hashtextextended('project_command:' || p_account_id::text || ':' || p_command_id::text, 0));

  -- 4. A command ID a rename already used is not a picture command.
  if exists (select 1 from projects.project_commands c where c.account_id = p_account_id and c.command_id = p_command_id) then
    v_result.outcome := 'reused';
    return v_result;
  end if;

  -- 5. The revision is the receipt.
  v_digest := projects.picture_set_digest(p_account_id, p_project_id, p_upload_ids);
  select * into v_existing from projects.request_revisions r where r.account_id = p_account_id and r.command_id = p_command_id;
  if found then
    if v_digest is distinct from v_existing.digest then
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
    v_result.seq := v_existing.seq;
    return v_result;
  end if;

  -- 6. An existing Project: its row locked (a tombstone and this write are serial), and still an unconfirmed picture request.
  if p_project_id is not null then
    perform 1
      from projects.projects p
     where p.id = p_project_id and p.account_id = p_account_id and p.deleted_at is null
       for update;
    if not found or lifecycle.is_tombstoned('project', p_project_id) then
      v_result.outcome := 'unavailable';
      return v_result;
    end if;
    select * into v_latest from projects.request_revisions r where r.project_id = p_project_id order by r.seq desc limit 1;
    if not found or v_latest.mode <> 'evidence_images' or v_latest.confirmed_at is not null then
      v_result.outcome := 'not_editable';
      return v_result;
    end if;
  end if;

  -- 7. Every upload, from its lease. The rows are locked first, in one order, so a release or a renewal made meanwhile is seen and no two writers
  -- wait for each other's rows.
  perform 1 from artifacts.staging_leases l where l.id = any(p_upload_ids) order by l.id for update;
  for v_row in
    select u.position, l.account_id, l.kind, l.state, l.expires_at, l.length, l.sha256
      from generate_series(1, cardinality(p_upload_ids)) as u(position)
      left join artifacts.staging_leases l on l.id = p_upload_ids[u.position]
     order by u.position
  loop
    v_result.position := v_row.position;
    if v_row.account_id is distinct from p_account_id or v_row.kind is distinct from 'picture' then
      v_result.outcome := 'unknown_upload';
      return v_result;
    end if;
    if v_row.state <> 'complete' then
      v_result.outcome := 'not_ready';
      return v_result;
    end if;
    if v_row.expires_at <= clock_timestamp() then
      v_result.outcome := 'expired_upload';
      return v_result;
    end if;
    -- The same bytes under two different uploads: the digest is the lease's, so the browser's own check (which had the same file hashed twice) is not what
    -- keeps a set from holding one picture twice.
    if v_row.sha256 = any(v_seen) then
      v_result.outcome := 'duplicate_image';
      return v_result;
    end if;
    v_seen := v_seen || v_row.sha256;
    v_total := v_total + v_row.length;
  end loop;
  v_result.position := null;

  -- 8. The set's size, from the leases.
  if v_total > 62914560 then
    v_result.outcome := 'too_large';
    return v_result;
  end if;

  -- 9. The same pictures in the same order as the latest revision: nothing to record. The Project is not touched (its revision and `updated_at` stay) and
  -- nothing is released, but the leases are renewed within the bound of step 10, so a save of the same set keeps it for another 24 hours.
  if p_project_id is not null then
    select coalesce(array_agg(i.upload_id order by i.position), '{}') into v_current from projects.request_images i where i.revision_id = v_latest.id;
    if v_current = p_upload_ids then
      update artifacts.staging_leases l
         set expires_at = least(clock_timestamp() + interval '24 hours', l.created_at + interval '7 days')
       where l.id = any(p_upload_ids);
      v_result.outcome := 'unchanged';
      v_result.project_id := p_project_id;
      v_result.request_id := v_latest.id;
      v_result.seq := v_latest.seq;
      return v_result;
    end if;
  end if;

  -- 10. The Project (born here, or raised by exactly one) and the revision with its pictures, together.
  v_now := clock_timestamp();
  if p_project_id is null then
    select w.id into v_workspace_id from projects.workspaces w where w.account_id = p_account_id;
    if not found then
      raise exception 'the Account has no Workspace' using errcode = '55000';
    end if;
    insert into projects.projects (workspace_id, account_id, title, stage, created_at, updated_at)
      values (v_workspace_id, p_account_id, p_title, 'request_draft', v_now, v_now)
      returning id into v_project_id;
    v_seq := 1;
    v_result.outcome := 'created';
  else
    update projects.projects p set revision = p.revision + 1, updated_at = v_now where p.id = p_project_id;
    v_project_id := p_project_id;
    v_seq := v_latest.seq + 1;
    v_result.outcome := 'revised';
  end if;

  insert into projects.request_revisions (
    project_id, account_id, seq, command_id, mode, subject_id, scope, outcome, description,
    personalization_wording, personalization_text, personalization_style, personalization_applied, personalization_reason,
    digest, confirmed_at, created_at
  ) values (
    v_project_id, p_account_id, v_seq, p_command_id, 'evidence_images', null, null, null, null,
    null, null, null, false, null,
    v_digest, null, v_now
  ) returning id into v_request_id;

  insert into projects.request_images (revision_id, project_id, account_id, position, upload_id, sha256, length, content_type)
    select v_request_id, v_project_id, p_account_id, u.position, p_upload_ids[u.position], l.sha256, l.length, l.content_type
      from generate_series(1, cardinality(p_upload_ids)) as u(position)
      join artifacts.staging_leases l on l.id = p_upload_ids[u.position]
     order by u.position;

  -- The leases of the set last another 24 hours from now, and never longer than 7 days from when they were created.
  update artifacts.staging_leases l
     set expires_at = least(clock_timestamp() + interval '24 hours', l.created_at + interval '7 days')
   where l.id = any(p_upload_ids);

  -- A successor frees what left the set: the uploads of the previous revision that the new one does not carry and no other Project's latest revision
  -- still uses are released at once (they stop counting toward the quota, and the hourly cleanup removes their staging objects).
  v_result.released := 0;
  if p_project_id is not null then
    update artifacts.staging_leases l
       set state = 'released'
     where l.account_id = p_account_id and l.state in ('receiving', 'complete')
       and l.id in (select i.upload_id from projects.request_images i where i.revision_id = v_latest.id)
       and not (l.id = any(p_upload_ids))
       and not exists (
         select 1
           from projects.request_images o
           join projects.request_revisions orv on orv.id = o.revision_id
          where o.upload_id = l.id and o.account_id = p_account_id
            and orv.seq = (select max(x.seq) from projects.request_revisions x where x.project_id = orv.project_id));
    get diagnostics v_result.released = row_count;
  end if;

  v_result.project_id := v_project_id;
  v_result.request_id := v_request_id;
  v_result.seq := v_seq;
  return v_result;
end;
$$;

comment on function api.record_picture_set(uuid, bigint, uuid, uuid, text, uuid[]) is
  'Records an ordered set of staged pictures as an unconfirmed request revision: creates the Project (stage request_draft, revision 1) and revision 1 when the Project ID is null, or appends a successor (seq + 1, the Project''s revision raised by one) to an unconfirmed picture Project. Reads each upload from its lease; enforces 1 to 12 pictures and 60 MiB; renews the leases to the earlier of 24 hours from now and 7 days from their creation; releases the uploads that left the set. created | revised | unchanged (nothing recorded and nothing released, but the included leases are renewed within the same bound) | replayed | reused | unavailable | not_editable | unknown_upload | not_ready | expired_upload | duplicate_image (two different uploads whose leases hold the same SHA-256; each of these four with the position, the first problem by position winning) | too_large | denied. Begins, after its argument checks (22023), with identity.assert_operation_authority.';

-- Releasing uploads that were never saved -------------------------------------------------------------------------------------------------------

create type api.picture_release as (outcome text, released integer);

-- Releases the Account's OWN picture uploads, in state `receiving` or `complete`, that no revision uses (a picture the person replaced or removed before
-- saving): they stop counting toward the Account's staging quota at once, and the hourly cleanup removes their objects. Anything else in the list (another
-- Account's, unknown, already released, or used by a revision) is left as it is and not counted. Answers how many were released.
--   released | denied
create function api.release_staged_pictures(p_account_id uuid, p_epoch bigint, p_upload_ids uuid[])
returns api.picture_release
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_result api.picture_release;
begin
  if p_account_id is null or p_epoch is null or p_epoch < 1
     or p_upload_ids is null or array_ndims(p_upload_ids) is distinct from 1 or array_lower(p_upload_ids, 1) <> 1
     or cardinality(p_upload_ids) not between 1 and 12 or array_position(p_upload_ids, null) is not null then
    raise exception 'invalid argument' using errcode = '22023';
  end if;

  begin
    perform identity.assert_operation_authority(p_account_id, p_epoch);
  exception when sqlstate 'N3010' then
    v_result.outcome := 'denied';
    return v_result;
  end;

  update artifacts.staging_leases l
     set state = 'released'
   where l.id = any(p_upload_ids) and l.account_id = p_account_id and l.kind = 'picture' and l.state in ('receiving', 'complete')
     and not exists (select 1 from projects.request_images i where i.upload_id = l.id);
  get diagnostics v_result.released = row_count;
  v_result.outcome := 'released';
  return v_result;
end;
$$;

comment on function api.release_staged_pictures(uuid, bigint, uuid[]) is
  'Releases the Account''s own picture uploads (receiving or complete) that no request revision uses, at once, and answers how many. Others in the list are left alone. released | denied. Begins with identity.assert_operation_authority.';

-- Reading the request: confirmed, and the pictures ----------------------------------------------------------------------------------------------

-- api.project_request_view gains `confirmed` and `images`, so the function and its type are dropped and made again (a composite type cannot gain a column
-- while a function returns it). `scope`, `intended_outcome`, `description` and `confirmed_at` are null for an unconfirmed revision.
drop function api.read_project_request(uuid, bigint, uuid);
drop type api.project_request_view;

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
  confirmed_at timestamptz,
  confirmed boolean,
  -- [{position, upload_id, sha256, length, content_type, expires_at, available}] in position order; [] when the revision has no pictures.
  images jsonb
);

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
  v_result.confirmed := v_revision.confirmed_at is not null;
  -- A picture is available while its upload is complete and unexpired. The lease's state and expiry are read as the owner; no key of Storage and no
  -- address of an object is ever part of the answer.
  select coalesce(jsonb_agg(jsonb_build_object(
           'position', i.position,
           'upload_id', i.upload_id,
           'sha256', i.sha256,
           'length', i.length,
           'content_type', i.content_type,
           'expires_at', l.expires_at,
           'available', coalesce(l.state = 'complete' and l.expires_at > clock_timestamp(), false)
         ) order by i.position), '[]'::jsonb)
    into v_result.images
    from projects.request_images i
    left join artifacts.staging_leases l on l.id = i.upload_id and l.account_id = i.account_id
   where i.revision_id = v_revision.id;
  return v_result;
end;
$$;

comment on function api.read_project_request(uuid, bigint, uuid) is
  'The latest request revision of a live Project of the Account, with whether it is confirmed and its pictures (position, upload ID, SHA-256, length, content type, expiry and whether the upload is still available). found | none (a Project without a revision) | unavailable (another Account''s, deleted, tombstoned and unknown Projects, one answer with nothing in it) | denied. Begins with identity.assert_operation_authority.';

-- Rename: the command ID lock is now closed in both directions ---------------------------------------------------------------------------------

-- As 20261012150000_projects.sql defined it, with one more refusal: a command ID that a request revision used (Story 2.1's confirmation, this story's
-- picture sets) is `reused`, as a rename's command ID is for the creations. It sits where the command ledger is read, after the Project row is locked
-- (so a Project that is not available is still `unavailable`).
create or replace function api.rename_project(p_account_id uuid, p_epoch bigint, p_command_id uuid, p_project_id uuid, p_expected_revision bigint, p_title text)
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

  -- A command ID a request revision used is not a rename, whatever else is the same.
  if exists (select 1 from projects.request_revisions r where r.account_id = p_account_id and r.command_id = p_command_id) then
    v_result.outcome := 'reused';
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
  'Renames a live Project of the Account in one transaction under a lock on the Project row, carrying a command ID and the expected revision. renamed (replayed when it is the original receipt of an identical earlier command) | stale (carries the current title and revision; nothing changes, no ledger row) | reused (the command ID was used for another payload, or by a request revision) | unavailable | denied. Begins with identity.assert_operation_authority.';

-- The preflight -----------------------------------------------------------------------------------------------------------------------------

-- Everything api.preflight read before (20261018120000_request_revisions.sql), plus what this story depends on: projects.request_images (with the columns the
-- functions use) and the two new functions and the digest helper exist and the service role may execute the two `api` ones (thirty-five `api` functions in
-- all). It checks the catalog and executes none of them, reads at most one row of each table and writes nothing. The bucket check stays last.
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
  perform y.revision_id, y.project_id, y.account_id, y.position, y.upload_id, y.sha256, y.length, y.content_type from projects.request_images y limit 1;
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
      'api.release_staged_pictures(uuid,bigint,uuid[])'
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
  'Reads identity.session_grants (including its CSRF columns), identity.accounts (including its status handle), identity.account_preferences, identity.step_up_nonces, identity.fresh_authentications (including source), identity.recovery_tokens, projects.projects, projects.project_commands, projects.request_revisions, projects.request_images, lifecycle.tombstones, lifecycle.ledger_outbox, lifecycle.ledger_relay, lifecycle.status_requests, lifecycle.job_receipts, the six artifacts tables and the artifacts.session_authority and artifacts.instance views, lifecycle.alarms, lifecycle.alarm_notices, lifecycle.heartbeats, auth.sessions, auth.identities and auth.mfa_amr_claims (one row each at most), checks that the Story 1.5, 1.6, 1.7, 1.8, 1.9, 1.12, 1.13, 2.1 and 2.2 functions exist and are executable by the service role, that the private-files bucket exists and is private, and that the owner may delete from auth.sessions and auth.users, and answers ok. Read-only.';

-- Access ------------------------------------------------------------------------------------------------------------------------------------

-- Closed by default; only the service role is let in, by name. projects.picture_set_digest, projects.check_revision_seq and the guards are granted to
-- nobody: SQL that runs as the owner calls them. (create or replace keeps the grants api.preflight and api.rename_project already had; the dropped
-- read function loses its grant with it, so it is granted again.)
grant execute on function api.record_picture_set(uuid, bigint, uuid, uuid, text, uuid[]) to service_role;
grant execute on function api.release_staged_pictures(uuid, bigint, uuid[]) to service_role;
grant execute on function api.read_project_request(uuid, bigint, uuid) to service_role;

-- New functions and types: have the Data API reload its schema cache now.
notify pgrst, 'reload schema';
