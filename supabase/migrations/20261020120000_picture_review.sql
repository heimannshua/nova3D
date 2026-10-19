-- Story 2.3: choose picture mode and acknowledge uncertainty.
--
-- A saved set of pictures is only a list. This story reviews it and records what the person decided about it: which view each picture shows (the person's
-- labels), what the browser measured of each (short edge, blur, clipped exposure: CLAIMS the browser makes, because the server never decodes an image), that
-- the person confirmed nothing blocks the subject, whether the pictures are used for DIRECT image-derived conversion (`image_direct`) or for research-assisted
-- reconstruction (`evidence_images`), and, for direct conversion with incomplete inputs, that the person knowingly accepted the risk of invented or inaccurate
-- geometry ("Generate anyway"). One command records all of it as an immutable SUCCESSOR request revision pinned to the ordered images. Nothing is converted,
-- researched, retained or paid for here (Stories 2.12, 2.13, 2.9 and the engine stories do those).
--
--   projects.request_images       gains four nullable columns, all present or all null: `view_label` (front, back, left, right, top, bottom, detail),
--                                 `short_edge_px`, `blur_variance` (3 decimals) and `clipped_fraction` (4 decimals). A picture set that was never reviewed
--                                 (Story 2.2) has none of them. They are claims of the browser: the database checks their range and shape, and applies the
--                                 rule below to them, and proves nothing about the picture.
--   projects.request_revisions    gains `obstruction_confirmed_at` (the person confirmed nothing blocks the subject), `incomplete_acknowledged_at` and
--                                 `incomplete_acknowledged_digest` (the Generate anyway acknowledgment: when, and the SHA-256 of the length-prefixed scope,
--                                 outcome and, for each picture in order, position, upload, staged SHA-256 and label, so it cannot be reused for other
--                                 pictures or another scope), the last two together or both null and only on a confirmed `image_direct` revision.
--                                 `request_revisions_confirmed_shape` is replaced: `confirmed_at`, `scope` and `outcome` are all null or all present;
--                                 `description` is null on an unconfirmed revision and may be null on a confirmed `image_direct` one (direct conversion
--                                 has no description: it has no subject to identify). A confirmed `evidence_text` still requires a description, and so does
--                                 a confirmed `evidence_images`.
--   projects.picture_review_*     the validation of the images argument, THE RULE (`picture_review_incomplete`: fewer than 3 distinct angles among front to
--                                 bottom, `detail` not counting, or any picture with a short edge under 800 px, a blur under 100 or a clipped share over
--                                 0.35; the same thresholds as lib/picture-quality.ts, and a test holds the two equal over a table of cases) and the two
--                                 digests. Granted to nobody: SQL that runs as the owner calls them.
--   api.record_picture_review     the ONE writer of a reviewed revision (see below).
--   api.record_picture_set        now accepts a latest revision that is an unconfirmed picture revision of EITHER mode (a reviewed revision is superseded
--                                 by an unreviewed successor, whose pictures carry no labels). Otherwise unchanged.
--   api.read_project_request      returns the labels and measurements of each picture and, per revision, `obstruction_confirmed` and `acknowledged` (with
--                                 their times).
--   api.preflight                 re-created carrying every earlier probe and the new ones.
--
-- record_picture_review, in order (the order of api.record_picture_set):
--   1. the arguments are checked (22023): 1 to 12 images, each `{upload_id, label, short_edge_px, blur_variance, clipped_fraction}` with one label from the seven
--      and measurements in range, none repeated; a mode of `evidence_images` or `image_direct`; a scope and an outcome present exactly for `image_direct` and
--      shaped as Story 2.1's (trimmed, 1 to 300 characters, no control character, not invisible, no bidirectional control).
--   2. identity.assert_operation_authority(account, epoch): a refusal (N3010) answers `denied` and writes nothing
--   3. the command ID is serialized (the advisory lock 'project_command:'||account||':'||command)
--   4. a command ID that a rename used is `reused`; one that a revision used replays the original receipt (`replayed`) for the same digest while its Project
--      is live (`unavailable` once the Project is gone) and is `reused` for another digest
--   5. the Project row is locked FOR UPDATE with the Account's own, `deleted_at is null` and no tombstone (`unavailable`: one answer for every case); the latest
--      revision is read: the command is `stale` (nothing written) when there is no revision, when the latest revision's `seq` is not `expected_seq`, or when its
--      ordered upload IDs are not exactly the supplied ones (not a picture revision, or the pictures changed meanwhile); a text request is `not_editable`, and so
--      is a Project whose stage is not `request_draft` or `request_confirmed` (a review never moves a Project BACKWARDS from research, approval or export)
--   6. every upload is read again from its lease as the owner, in position order, as record_picture_set does: `unknown_upload`, `not_ready`, `expired_upload` with the
--      position
--   7. `obstruction_not_confirmed` unless the person confirmed nothing blocks the subject
--   8. for `image_direct`, whether the inputs are incomplete is RECOMPUTED here from the labels and measurements: if they are and `acknowledge` is false the
--      answer is `acknowledgment_required` and nothing is written; if they are, the acknowledgment (time and digest) is recorded; if they are not, none is
--   9. an identical re-confirmation is not a new revision: when the latest revision already has the same mode, scope, outcome, obstruction confirmation, pictures
--      (upload, label and measurements at each position) and acknowledgment state, the answer is `unchanged` with its IDs, nothing is written and the Project is
--      not touched, but the leases are renewed within the bound of step 10 (as an unchanged picture set's are)
--  10. otherwise in one transaction: the Project's revision rises by exactly one and its stage becomes `request_confirmed` (a confirmed direct revision) or
--      `request_draft` (research-assisted), the successor is inserted (`seq + 1`; confirmed with the scope and outcome and no subject for direct, unconfirmed with
--      none for research-assisted), its images are copied in order with their labels and measurements, and the leases are renewed within the Story 2.2 bound
--      (the earlier of 24 hours from now and 7 days after they were created)
--
-- The revision carries no subject, no description, no personalization, and no approval, permission, payment or cost: confirming a direct request starts no
-- conversion, approves no plan and authorizes no cost.

-- The pictures' labels and measurements -----------------------------------------------------------------------------------------

alter table projects.request_images add column view_label text
  check (view_label in ('front', 'back', 'left', 'right', 'top', 'bottom', 'detail'));
alter table projects.request_images add column short_edge_px integer check (short_edge_px >= 1);
-- The population variance of the integer Laplacian responses: never negative, and at most 1020 squared (a 0/255 checkerboard).
alter table projects.request_images add column blur_variance numeric(10, 3) check (blur_variance >= 0 and blur_variance <= 1040400);
alter table projects.request_images add column clipped_fraction numeric(5, 4) check (clipped_fraction >= 0 and clipped_fraction <= 1);
alter table projects.request_images add constraint request_images_review_shape check (
  (view_label is null) = (short_edge_px is null) and (view_label is null) = (blur_variance is null) and (view_label is null) = (clipped_fraction is null)
);

-- The review of a revision -------------------------------------------------------------------------------------------------------

alter table projects.request_revisions add column obstruction_confirmed_at timestamptz;
alter table projects.request_revisions add column incomplete_acknowledged_at timestamptz;
alter table projects.request_revisions add column incomplete_acknowledged_digest text check (incomplete_acknowledged_digest ~ '^[0-9a-f]{64}$');

-- What the person confirmed is all there or all absent: a time, a scope and an outcome together. A description belongs to a text request and to evidence-backed
-- pictures, and to nothing unconfirmed; a confirmed `image_direct` revision may have none (it has no subject to describe).
alter table projects.request_revisions drop constraint request_revisions_confirmed_shape;
alter table projects.request_revisions add constraint request_revisions_confirmed_shape check (
  (confirmed_at is null) = (scope is null) and (confirmed_at is null) = (outcome is null)
  and (confirmed_at is not null or description is null)
  and (confirmed_at is null or description is not null or mode = 'image_direct')
);
-- A picture review is of a picture request. An acknowledgment is of a confirmed direct request whose obstruction question was answered, with both parts or neither.
alter table projects.request_revisions add constraint request_revisions_obstruction_shape check (obstruction_confirmed_at is null or mode in ('evidence_images', 'image_direct'));
alter table projects.request_revisions add constraint request_revisions_acknowledgment_shape check (
  (incomplete_acknowledged_at is null) = (incomplete_acknowledged_digest is null)
  and (incomplete_acknowledged_at is null or (mode = 'image_direct' and confirmed_at is not null and obstruction_confirmed_at is not null))
);

-- The rule, the digests and the images argument --------------------------------------------------------------------------------

-- Whether an `images` argument is well formed: an array of 1 to 12 objects with exactly the five members `upload_id` (a lower-case UUID, none repeated), `label`
-- (one of the seven), `short_edge_px` (a whole number from 1), `blur_variance` (a number from 0 to 1,040,400 with at most 3 decimals) and `clipped_fraction` (a
-- number from 0 to 1 with at most 4 decimals). Step by step, so no cast runs on a value that was not checked first.
create function projects.picture_review_images_valid(p_images jsonb) returns boolean
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_item jsonb;
  v_seen text[] := '{}';
begin
  if p_images is null or jsonb_typeof(p_images) <> 'array' or jsonb_array_length(p_images) not between 1 and 12 then
    return false;
  end if;
  for v_item in select e.value from jsonb_array_elements(p_images) as e(value) loop
    if jsonb_typeof(v_item) <> 'object' or (select count(*) from jsonb_object_keys(v_item)) <> 5
       or not (v_item ? 'upload_id' and v_item ? 'label' and v_item ? 'short_edge_px' and v_item ? 'blur_variance' and v_item ? 'clipped_fraction') then
      return false;
    end if;
    if jsonb_typeof(v_item -> 'upload_id') <> 'string' or (v_item ->> 'upload_id') !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
       or (v_item ->> 'upload_id') = any(v_seen) then
      return false;
    end if;
    v_seen := v_seen || (v_item ->> 'upload_id');
    if jsonb_typeof(v_item -> 'label') <> 'string' or (v_item ->> 'label') not in ('front', 'back', 'left', 'right', 'top', 'bottom', 'detail') then
      return false;
    end if;
    if jsonb_typeof(v_item -> 'short_edge_px') <> 'number' or (v_item ->> 'short_edge_px') !~ '^[1-9][0-9]{0,8}$' then
      return false;
    end if;
    if jsonb_typeof(v_item -> 'blur_variance') <> 'number' or (v_item ->> 'blur_variance') !~ '^[0-9]{1,7}(\.[0-9]{1,3})?$' then
      return false;
    end if;
    if (v_item ->> 'blur_variance')::numeric > 1040400 then
      return false;
    end if;
    if jsonb_typeof(v_item -> 'clipped_fraction') <> 'number' or (v_item ->> 'clipped_fraction') !~ '^[01](\.[0-9]{1,4})?$' then
      return false;
    end if;
    if (v_item ->> 'clipped_fraction')::numeric > 1 then
      return false;
    end if;
  end loop;
  return true;
end;
$$;

-- THE RULE, the database's twin of `incomplete` in lib/picture-quality.ts: fewer than 3 distinct angles among front to bottom (a `detail` close-up is not an
-- angle), or any picture with a short edge under 800 px, a blur under 100 or a clipped share over 0.35. It is applied to the numbers the browser CLAIMED, only
-- to decide whether an acknowledgment is required: the numbers are not proved. `p_images` is a valid images argument.
create function projects.picture_review_incomplete(p_images jsonb) returns boolean
language sql
immutable
set search_path = ''
as $$
  select (select count(distinct i.value ->> 'label') from jsonb_array_elements(p_images) as i(value)
           where i.value ->> 'label' in ('front', 'back', 'left', 'right', 'top', 'bottom')) < 3
      or exists (select 1 from jsonb_array_elements(p_images) as i(value)
                  where (i.value ->> 'short_edge_px')::integer < 800
                     or (i.value ->> 'blur_variance')::numeric < 100
                     or (i.value ->> 'clipped_fraction')::numeric > 0.35)
$$;

-- The digest an acknowledgment is pinned to: SHA-256 (hex) over the length-prefixed (projects.length_prefixed) scope, outcome and, for each position in order, the
-- position, the upload, the SHA-256 READ FROM THE UPLOAD'S LEASE (the staged one, so Story 2.12's retained copies stay verifiable) and the label. lib/picture-quality.ts
-- `reviewDigestInput` is the same text. Null when any upload is not the Account's own picture lease.
create function projects.picture_review_digest(p_account_id uuid, p_scope text, p_outcome text, p_upload_ids uuid[], p_labels text[]) returns text
language sql
stable
set search_path = ''
as $$
  select case when count(l.id) = cardinality(p_upload_ids) then
    encode(sha256(convert_to(
      projects.length_prefixed(p_scope) || projects.length_prefixed(p_outcome)
      || string_agg(
           projects.length_prefixed(u.position::text) || projects.length_prefixed(p_upload_ids[u.position]::text) || projects.length_prefixed(l.sha256)
           || projects.length_prefixed(p_labels[u.position]),
           '' order by u.position),
      'UTF8')), 'hex')
  end
  from generate_series(1, cardinality(p_upload_ids)) as u(position)
  left join artifacts.staging_leases l on l.id = p_upload_ids[u.position] and l.account_id = p_account_id and l.kind = 'picture'
$$;

-- The digest of the COMMAND (the revision's own `digest`, what "the same command" means): SHA-256 (hex) over the length-prefixed Project, expected `seq`, mode,
-- scope, outcome, obstruction and acknowledge flags, then for each position the position, upload, the lease's SHA-256, the label and the three measurements.
-- Null when any upload is not the Account's own picture lease. `p_images` is a valid images argument.
create function projects.picture_review_command_digest(
  p_account_id uuid, p_project_id uuid, p_expected_seq integer, p_mode text, p_scope text, p_outcome text, p_images jsonb, p_obstruction boolean, p_acknowledge boolean
) returns text
language sql
stable
set search_path = ''
as $$
  select case when count(l.id) = jsonb_array_length(p_images) then
    encode(sha256(convert_to(
      'record_picture_review' || E'\n'
      || projects.length_prefixed(p_project_id::text) || projects.length_prefixed(p_expected_seq::text) || projects.length_prefixed(p_mode)
      || projects.length_prefixed(p_scope) || projects.length_prefixed(p_outcome)
      || projects.length_prefixed(p_obstruction::text) || projects.length_prefixed(p_acknowledge::text)
      || string_agg(
           projects.length_prefixed(e.position::text) || projects.length_prefixed(e.value ->> 'upload_id') || projects.length_prefixed(l.sha256)
           || projects.length_prefixed(e.value ->> 'label') || projects.length_prefixed(e.value ->> 'short_edge_px')
           || projects.length_prefixed(trim_scale((e.value ->> 'blur_variance')::numeric)::text)
           || projects.length_prefixed(trim_scale((e.value ->> 'clipped_fraction')::numeric)::text),
           '' order by e.position),
      'UTF8')), 'hex')
  end
  from jsonb_array_elements(p_images) with ordinality as e(value, position)
  left join artifacts.staging_leases l on l.id = (e.value ->> 'upload_id')::uuid and l.account_id = p_account_id and l.kind = 'picture'
$$;

-- Appending pictures to an unconfirmed picture Project: either mode ---------------------------------------------------------------------

-- As 20261019120000_picture_sets.sql defined it, with one change: the latest revision may be an unconfirmed picture revision of either mode (step 6). A
-- successor made here is the provisional `evidence_images`, unreviewed: its pictures carry no labels or measurements.

create or replace function api.record_picture_set(p_account_id uuid, p_epoch bigint, p_command_id uuid, p_project_id uuid, p_title text, p_upload_ids uuid[])
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

  -- 6. An existing Project: its row locked (a tombstone and this write are serial), and still an unconfirmed picture request (of either picture mode:
  -- Story 2.3 records the explicit choice, and a reviewed revision is superseded by this unreviewed successor, whose pictures carry no labels).
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
    if not found or v_latest.mode not in ('evidence_images', 'image_direct') or v_latest.confirmed_at is not null then
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
  'Records an ordered set of staged pictures as an unconfirmed request revision: creates the Project (stage request_draft, revision 1) and revision 1 when the Project ID is null, or appends a successor (seq + 1, the Project''s revision raised by one) to a Project whose latest revision is an unconfirmed picture revision of either mode (a reviewed revision is superseded by an unreviewed successor, whose pictures carry no labels). Reads each upload from its lease; enforces 1 to 12 pictures and 60 MiB; renews the leases to the earlier of 24 hours from now and 7 days from their creation; releases the uploads that left the set. created | revised | unchanged (nothing recorded and nothing released, but the included leases are renewed within the same bound) | replayed | reused | unavailable | not_editable | unknown_upload | not_ready | expired_upload | duplicate_image (two different uploads whose leases hold the same SHA-256; each of these four with the position, the first problem by position winning) | too_large | denied. Begins, after its argument checks (22023), with identity.assert_operation_authority.';

-- Recording a review ------------------------------------------------------------------------------------------------------------

-- `position` is the one the answer is about (unknown_upload, not_ready, expired_upload); `seq` is the new revision's, or the latest's for `stale`.
create type api.picture_review_recording as (outcome text, project_id uuid, request_id uuid, seq integer, position integer);

-- Records the review of the pictures of a Project as a successor revision. See the top of this file for the outcomes and the order.
--   created | replayed | unchanged | stale | reused | unavailable | not_editable | unknown_upload | not_ready | expired_upload | obstruction_not_confirmed | acknowledgment_required | denied
create function api.record_picture_review(
  p_account_id uuid,
  p_epoch bigint,
  p_command_id uuid,
  p_project_id uuid,
  p_expected_seq integer,
  p_mode text,
  p_scope text,
  p_outcome text,
  p_images jsonb,
  p_obstruction_confirmed boolean,
  p_acknowledge boolean
)
returns api.picture_review_recording
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_result api.picture_review_recording;
  v_existing projects.request_revisions;
  v_latest projects.request_revisions;
  v_request_id uuid;
  v_upload_ids uuid[];
  v_labels text[];
  v_current uuid[];
  v_digest text;
  v_now timestamptz;
  v_row record;
  v_direct boolean;
  v_incomplete boolean;
  v_stage text;
  v_same boolean;
begin
  -- 1. The arguments: a shape the application would never send is refused here with a code, and the table's own checks are the second line.
  if p_account_id is null or p_epoch is null or p_epoch < 1 or p_command_id is null or p_project_id is null
     or p_expected_seq is null or p_expected_seq < 1
     or p_mode is null or p_mode not in ('evidence_images', 'image_direct')
     or p_obstruction_confirmed is null or p_acknowledge is null
     or (p_mode = 'image_direct') <> (p_scope is not null) or (p_mode = 'image_direct') <> (p_outcome is not null)
     or (p_scope is not null and (
           p_scope <> btrim(p_scope) or char_length(p_scope) not between 1 and 300 or p_scope ~ '[\u0001-\u001f\u007f-\u009f]'
           or projects.is_invisible(p_scope) or projects.has_bidi_control(p_scope)))
     or (p_outcome is not null and (
           p_outcome <> btrim(p_outcome) or char_length(p_outcome) not between 1 and 300 or p_outcome ~ '[\u0001-\u001f\u007f-\u009f]'
           or projects.is_invisible(p_outcome) or projects.has_bidi_control(p_outcome)))
     or not projects.picture_review_images_valid(p_images) then
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

  -- 4. A command ID a rename already used is not a review. The revision is the receipt.
  if exists (select 1 from projects.project_commands c where c.account_id = p_account_id and c.command_id = p_command_id) then
    v_result.outcome := 'reused';
    return v_result;
  end if;

  select array_agg((e.value ->> 'upload_id')::uuid order by e.position), array_agg(e.value ->> 'label' order by e.position)
    into v_upload_ids, v_labels
    from jsonb_array_elements(p_images) with ordinality as e(value, position);
  v_digest := projects.picture_review_command_digest(p_account_id, p_project_id, p_expected_seq, p_mode, p_scope, p_outcome, p_images, p_obstruction_confirmed, p_acknowledge);

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

  -- 5. The Project, its row locked (a tombstone and this write are serial), and its latest revision still the one the person reviewed.
  select p.stage into v_stage
    from projects.projects p
   where p.id = p_project_id and p.account_id = p_account_id and p.deleted_at is null
     for update;
  if not found or lifecycle.is_tombstoned('project', p_project_id) then
    v_result.outcome := 'unavailable';
    return v_result;
  end if;
  select * into v_latest from projects.request_revisions r where r.project_id = p_project_id order by r.seq desc limit 1;
  if not found then
    v_result.outcome := 'stale';
    return v_result;
  end if;
  -- A text request has no pictures to review, and a review never moves a Project BACKWARDS: only a Project still at the request stage (a draft, or a confirmed
  -- request) is reviewed. One that went on (researching, awaiting approval, ...) is `not_editable`, and nothing is written.
  if v_latest.mode = 'evidence_text' or v_stage not in ('request_draft', 'request_confirmed') then
    v_result.outcome := 'not_editable';
    return v_result;
  end if;
  v_result.seq := v_latest.seq;
  select coalesce(array_agg(i.upload_id order by i.position), '{}') into v_current from projects.request_images i where i.revision_id = v_latest.id;
  if v_latest.seq <> p_expected_seq or v_current <> v_upload_ids then
    v_result.outcome := 'stale';
    return v_result;
  end if;
  v_result.seq := null;

  -- 6. Every upload, from its lease, again. The rows are locked first, in one order, so a release or a renewal made meanwhile is seen.
  perform 1 from artifacts.staging_leases l where l.id = any(v_upload_ids) order by l.id for update;
  for v_row in
    select u.position, l.account_id, l.kind, l.state, l.expires_at
      from generate_series(1, cardinality(v_upload_ids)) as u(position)
      left join artifacts.staging_leases l on l.id = v_upload_ids[u.position]
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
  end loop;
  v_result.position := null;

  -- 7. The person confirmed that nothing blocks the subject. There is no override.
  if not p_obstruction_confirmed then
    v_result.outcome := 'obstruction_not_confirmed';
    return v_result;
  end if;

  -- 8. Direct conversion with incomplete inputs needs the acknowledgment; whether they are incomplete is decided HERE, from the labels and measurements
  -- (the browser's claims), by the same rule as lib/picture-quality.ts, and never from a flag the browser sends.
  v_direct := p_mode = 'image_direct';
  v_incomplete := v_direct and projects.picture_review_incomplete(p_images);
  if v_incomplete and not p_acknowledge then
    v_result.outcome := 'acknowledgment_required';
    return v_result;
  end if;

  -- 9. An identical re-confirmation is not a new revision: the latest revision already holds this mode, scope, outcome and obstruction confirmation, the same
  -- pictures in the same order with the same labels and measurements, and the same acknowledgment state (a lost answer, then Confirm pressed again after a reload,
  -- under a new command ID). Nothing is recorded and the Project is not touched, but the leases are renewed within the bound of step 10, as an unchanged picture set's are.
  v_same := v_latest.mode = p_mode
    and v_latest.scope is not distinct from p_scope
    and v_latest.outcome is not distinct from p_outcome
    and (v_latest.confirmed_at is not null) = v_direct
    and v_latest.obstruction_confirmed_at is not null
    and (v_latest.incomplete_acknowledged_at is not null) = v_incomplete
    and (select count(*)
           from jsonb_array_elements(p_images) with ordinality as e(value, position)
           join projects.request_images i on i.revision_id = v_latest.id and i.position = e.position
          where i.upload_id = (e.value ->> 'upload_id')::uuid
            and i.view_label is not distinct from (e.value ->> 'label')
            and i.short_edge_px = (e.value ->> 'short_edge_px')::integer
            and i.blur_variance = (e.value ->> 'blur_variance')::numeric
            and i.clipped_fraction = (e.value ->> 'clipped_fraction')::numeric) = jsonb_array_length(p_images);
  if v_same then
    update artifacts.staging_leases l
       set expires_at = least(clock_timestamp() + interval '24 hours', l.created_at + interval '7 days')
     where l.id = any(v_upload_ids);
    v_result.outcome := 'unchanged';
    v_result.project_id := p_project_id;
    v_result.request_id := v_latest.id;
    v_result.seq := v_latest.seq;
    return v_result;
  end if;

  -- 10. The Project (its revision raised by exactly one and its stage set) and the successor with its pictures, together.
  v_now := clock_timestamp();
  update projects.projects p
     set revision = p.revision + 1, updated_at = v_now, stage = case when v_direct then 'request_confirmed' else 'request_draft' end
   where p.id = p_project_id and p.stage in ('request_draft', 'request_confirmed');

  insert into projects.request_revisions (
    project_id, account_id, seq, command_id, mode, subject_id, scope, outcome, description,
    personalization_wording, personalization_text, personalization_style, personalization_applied, personalization_reason,
    digest, confirmed_at, created_at, obstruction_confirmed_at, incomplete_acknowledged_at, incomplete_acknowledged_digest
  ) values (
    p_project_id, p_account_id, v_latest.seq + 1, p_command_id, p_mode, null, p_scope, p_outcome, null,
    null, null, null, false, null,
    v_digest, case when v_direct then v_now end, v_now, v_now,
    case when v_incomplete then v_now end,
    case when v_incomplete then projects.picture_review_digest(p_account_id, p_scope, p_outcome, v_upload_ids, v_labels) end
  ) returning id into v_request_id;

  insert into projects.request_images (revision_id, project_id, account_id, position, upload_id, sha256, length, content_type, view_label, short_edge_px, blur_variance, clipped_fraction)
    select v_request_id, p_project_id, p_account_id, e.position, (e.value ->> 'upload_id')::uuid, l.sha256, l.length, l.content_type,
           e.value ->> 'label', (e.value ->> 'short_edge_px')::integer, (e.value ->> 'blur_variance')::numeric, (e.value ->> 'clipped_fraction')::numeric
      from jsonb_array_elements(p_images) with ordinality as e(value, position)
      join artifacts.staging_leases l on l.id = (e.value ->> 'upload_id')::uuid
     order by e.position;

  -- The leases of the set last another 24 hours from now, and never longer than 7 days from when they were created (the bound of Story 2.2).
  update artifacts.staging_leases l
     set expires_at = least(clock_timestamp() + interval '24 hours', l.created_at + interval '7 days')
   where l.id = any(v_upload_ids);

  v_result.outcome := 'created';
  v_result.project_id := p_project_id;
  v_result.request_id := v_request_id;
  v_result.seq := v_latest.seq + 1;
  return v_result;
end;
$$;

comment on function api.record_picture_review(uuid, bigint, uuid, uuid, integer, text, text, text, jsonb, boolean, boolean) is
  'Records the review of a Project''s pictures as a successor request revision (seq + 1, the Project''s revision raised by one): the mode (evidence_images, research-assisted, unconfirmed, stage request_draft; or image_direct, confirmed with the scope and outcome and no subject, stage request_confirmed), the person''s labels and the browser''s measurements of each picture (claims, stored as sent), that the person confirmed nothing blocks the subject, and, for image_direct with incomplete inputs (recomputed here), the Generate anyway acknowledgment with its time and the digest of the scope and the ordered pictures. Renews the leases within the Story 2.2 bound. created | replayed | unchanged (the latest revision already holds exactly this review: nothing is recorded, the leases are renewed) | stale (the latest revision is not the one reviewed; carries its seq) | reused | unavailable | not_editable (a text request, or a Project whose stage is not request_draft or request_confirmed) | unknown_upload | not_ready | expired_upload (each with the position) | obstruction_not_confirmed | acknowledgment_required | denied. Begins, after its argument checks (22023), with identity.assert_operation_authority. Starts no conversion, approves no plan and authorizes no cost.';

-- Reading the request: labels, measurements and the review ------------------------------------------------------------------------

-- api.project_request_view gains the review of the revision, so the function and its type are dropped and made again.
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
  -- [{position, upload_id, sha256, length, content_type, expires_at, available, label, short_edge_px, blur_variance, clipped_fraction}] in position order; [] when
  -- the revision has no pictures. The last four are null for a picture set that was never reviewed.
  images jsonb,
  -- Whether the person confirmed that nothing blocks the subject, and when; whether they acknowledged incomplete inputs (Generate anyway), and when.
  obstruction_confirmed boolean,
  obstruction_confirmed_at timestamptz,
  acknowledged boolean,
  acknowledged_at timestamptz
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
  v_result.obstruction_confirmed := v_revision.obstruction_confirmed_at is not null;
  v_result.obstruction_confirmed_at := v_revision.obstruction_confirmed_at;
  v_result.acknowledged := v_revision.incomplete_acknowledged_at is not null;
  v_result.acknowledged_at := v_revision.incomplete_acknowledged_at;
  -- A picture is available while its upload is complete and unexpired. The lease's state and expiry are read as the owner; no key of Storage and no
  -- address of an object is ever part of the answer.
  select coalesce(jsonb_agg(jsonb_build_object(
           'position', i.position,
           'upload_id', i.upload_id,
           'sha256', i.sha256,
           'length', i.length,
           'content_type', i.content_type,
           'expires_at', l.expires_at,
           'available', coalesce(l.state = 'complete' and l.expires_at > clock_timestamp(), false),
           'label', i.view_label,
           'short_edge_px', i.short_edge_px,
           'blur_variance', i.blur_variance,
           'clipped_fraction', i.clipped_fraction
         ) order by i.position), '[]'::jsonb)
    into v_result.images
    from projects.request_images i
    left join artifacts.staging_leases l on l.id = i.upload_id and l.account_id = i.account_id
   where i.revision_id = v_revision.id;
  return v_result;
end;
$$;

comment on function api.read_project_request(uuid, bigint, uuid) is
  'The latest request revision of a live Project of the Account, with whether it is confirmed, its pictures (position, upload ID, SHA-256, length, content type, expiry, whether the upload is still available, and the label and measurements of a reviewed picture) and the review of the revision (whether the person confirmed nothing blocks the subject, and whether they acknowledged incomplete inputs, with the times). found | none (a Project without a revision) | unavailable (another Account''s, deleted, tombstoned and unknown Projects, one answer with nothing in it) | denied. Begins with identity.assert_operation_authority.';

-- The preflight -----------------------------------------------------------------------------------------------------------------------------

-- Everything api.preflight read before (20261019120000_picture_sets.sql), plus what this story depends on: the review columns of projects.request_revisions and
-- projects.request_images, the writer and its helpers exist and the service role may execute the writer (thirty-six `api` functions in all). It checks the
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
  perform y.revision_id, y.project_id, y.account_id, y.position, y.upload_id, y.sha256, y.length, y.content_type, y.view_label, y.short_edge_px, y.blur_variance, y.clipped_fraction from projects.request_images y limit 1;
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
      'api.record_picture_review(uuid,bigint,uuid,uuid,integer,text,text,text,jsonb,boolean,boolean)'
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
  'Reads identity.session_grants (including its CSRF columns), identity.accounts (including its status handle), identity.account_preferences, identity.step_up_nonces, identity.fresh_authentications (including source), identity.recovery_tokens, projects.projects, projects.project_commands, projects.request_revisions (including the review columns), projects.request_images (including the labels and measurements), lifecycle.tombstones, lifecycle.ledger_outbox, lifecycle.ledger_relay, lifecycle.status_requests, lifecycle.job_receipts, the six artifacts tables and the artifacts.session_authority and artifacts.instance views, lifecycle.alarms, lifecycle.alarm_notices, lifecycle.heartbeats, auth.sessions, auth.identities and auth.mfa_amr_claims (one row each at most), checks that the Story 1.5, 1.6, 1.7, 1.8, 1.9, 1.12, 1.13, 2.1, 2.2 and 2.3 functions exist and are executable by the service role, that the private-files bucket exists and is private, and that the owner may delete from auth.sessions and auth.users, and answers ok. Read-only.';

-- Access ------------------------------------------------------------------------------------------------------------------------------------

-- Closed by default; only the service role is let in, by name. The projects.picture_review_* helpers are granted to nobody: SQL that runs as the owner calls
-- them. (create or replace keeps the grants api.preflight and api.record_picture_set already had; the dropped read function loses its grant with it, so it is
-- granted again.)
grant execute on function api.record_picture_review(uuid, bigint, uuid, uuid, integer, text, text, text, jsonb, boolean, boolean) to service_role;
grant execute on function api.read_project_request(uuid, bigint, uuid) to service_role;

-- New functions and types: have the Data API reload its schema cache now.
notify pgrst, 'reload schema';
