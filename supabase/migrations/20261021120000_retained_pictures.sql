-- Story 2.12: retain confirmed pictures as immutable Project artifacts.
--
-- The pictures a person confirmed live only in lease-bounded staging, which lapses 24 hours after the last save and keeps their location data. This story
-- keeps them: at the end of the Story 2.3 review the gateway's attach step strips every metadata segment from the copy except the EXIF orientation, publishes
-- it as an immutable manifest root, and the review's successor revision pins the ordered roots beside the staged digests they replace; the staging copies then
-- expire. Retention happens BEFORE the review is recorded, so a failure confirms nothing, and the review writer reads the roots it pins from
-- `artifacts.manifests` itself: the browser never names a root.
--
-- The sequence (the application's, lib/retention.ts): (1) api.check_picture_retention, a read-only pre-check; (2) the attaches, in parallel, each a signed
-- `attach` command with the transform `strip-picture-metadata` at the gateway; (3) api.record_picture_review, which pins what was published; (4) the staged
-- copies expire (the writer sets the pinned leases' `expires_at` to the database clock, and the hourly cleanup of Story 1.12 deletes them).
--
--   artifacts.attachment_transforms   registers `strip-picture-metadata`. The transform `none` and the six-argument artifacts.publish_attachment keep
--                                     working exactly as before, so the previous gateway still works against this database.
--   artifacts.publish_attachment      for the new transform takes the retained digest and length from the canonical body (digest 64 hex, length from 1 to
--                                     the lease's length plus 4,096), still requires the staged lease and the canonical text, and takes the advisory lock
--                                     `nova3d:retained:<account>` to refuse `quota_exceeded` when the Account's retained pictures plus this length would
--                                     pass 2 GiB (the race backstop for the pre-check). A manifest that is published but never pinned (a failed or abandoned
--                                     confirmation) is kept, reused by the next attempt and counted against the quota until Epic 8 can delete it.
--   artifacts.manifests               gains an index on (account_id, kind): the quota sums by it.
--   projects.request_images           gains nullable `retained_root`, `retained_sha256` and `retained_length`, all present or all null. They are filled by the
--                                     review writer from artifacts.manifests (never from the browser); the staged `sha256` stays beside them, so each retained
--                                     digest maps to the staged digest the person confirmed, in order. (The earlier test bans on these words in the column
--                                     names of this table are changed on purpose.)
--   api.check_picture_retention       the read-only pre-check (no writes): authority, the Project, the revision, every upload, the 2 GiB quota; and, per
--                                     position, `attach` (no manifest yet) or `retained` (a manifest of that upload exists, with its root).
--   api.record_picture_review         keeps its signature and gains: every upload must have a manifest (`not_retained` at the position); an `attached` lease
--                                     is accepted when its manifest exists; the `unchanged` rule also requires that the latest revision already pins the same
--                                     roots; on commit the pinned leases' `expires_at` is set to the database clock.
--   api.record_picture_set            accepts a lease whose picture manifest exists (an `attached` lease, or one whose staged copy has gone) and carries that
--                                     upload's pins into the unreviewed successor.
--   api.read_project_request          reports `available` true for a picture that is pinned (and for an `attached` lease that has not lapsed).
--   api.read_retained_pictures        the latest revision's pinned pictures in order, and nothing else of the revision.
--   artifacts.retained_pictures       the live-authorization view of the retained-picture resolver (workers/files/src/resolvers.ts): a pinned picture of a
--                                     live Project of the same Account.
--   api.preflight                     re-created carrying every earlier probe and the new ones.

-- The transform and the index ---------------------------------------------------------------------------------------------------------

comment on table artifacts.attachment_transforms is
  'The registered attachment transforms: `none`, and `strip-picture-metadata` (Story 2.12: the gateway removes every metadata segment of a picture except the EXIF orientation, losslessly for the pixels).';

insert into artifacts.attachment_transforms (name) values ('strip-picture-metadata');

-- "How many bytes of pictures does this Account keep?" (api.check_picture_retention and artifacts.publish_attachment sum the length by it).
create index manifests_account_kind on artifacts.manifests (account_id, kind);

-- The pins ---------------------------------------------------------------------------------------------------------------------------------

alter table projects.request_images add column retained_root text check (retained_root ~ '^[0-9a-f]{64}$');
alter table projects.request_images add column retained_sha256 text check (retained_sha256 ~ '^[0-9a-f]{64}$');
alter table projects.request_images add column retained_length integer check (retained_length >= 1);
alter table projects.request_images add constraint request_images_retained_shape check (
  (retained_root is null) = (retained_sha256 is null) and (retained_root is null) = (retained_length is null)
);

comment on column projects.request_images.retained_root is
  'The manifest root of the retained (metadata-stripped) copy of this picture, read by the review writer from artifacts.manifests; null while the picture is only staged.';
comment on column projects.request_images.retained_sha256 is 'The SHA-256 of the retained copy. `sha256` stays the staged digest the person confirmed.';
comment on column projects.request_images.retained_length is 'The length of the retained copy in bytes.';

-- Publishing an attachment -------------------------------------------------------------------------------------------------------------

-- As 20261015120000_file_gateway.sql defined it (same signature, same grants, the transform `none` byte for byte as before), with one addition: for the
-- transform `strip-picture-metadata` the manifest describes the STRIPPED copy, so its digest and length are the retained copy's, not the lease's.
--   * the digest (64 lower-case hex) and the length (from 1 to the lease's length plus 4,096) are read out of the canonical body, and the body must still equal,
--     byte for byte, the canonical text the function builds from them and from the lease (so whitespace, another order of members, a repeated member or any
--     other spelling is refused as before);
--   * the lease must be a picture's (`transform_unknown` otherwise);
--   * after the manifest lookup (a repeat answers `exists` and counts nothing again), the Account's retained pictures are summed under the advisory lock
--     `nova3d:retained:<account>`, and a manifest that would take them past 2 GiB (2,147,483,648 bytes) is refused `quota_exceeded`, nothing written.
--   published | exists | denied | not_found | not_complete | expired | transform_unknown | root_mismatch | body_mismatch | quota_exceeded
create or replace function artifacts.publish_attachment(p_account_id uuid, p_epoch bigint, p_upload_id uuid, p_transform text, p_root text, p_body text)
returns artifacts.attachment_receipt
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_result artifacts.attachment_receipt;
  v_lease artifacts.staging_leases;
  v_manifest artifacts.manifests;
  v_expected text;
  v_stripped boolean;
  v_digest text;
  v_length bigint;
  v_kept bigint;
begin
  if p_account_id is null or p_epoch is null or p_epoch < 1 or p_upload_id is null or p_transform is null or p_transform !~ '^[a-z][a-z0-9-]{0,62}$'
     or p_root is null or p_root !~ '^[0-9a-f]{64}$' or p_body is null or octet_length(p_body) > 4096 then
    raise exception 'invalid argument' using errcode = '22023';
  end if;

  begin
    perform identity.assert_operation_authority(p_account_id, p_epoch);
  exception when sqlstate 'N3010' then
    v_result.outcome := 'denied';
    return v_result;
  end;

  -- The lease is locked, and read after the lock: a cleanup that released it while this waited is seen.
  select * into v_lease from artifacts.staging_leases l where l.id = p_upload_id and l.account_id = p_account_id for update;
  if not found then
    v_result.outcome := 'not_found';
    return v_result;
  end if;

  select * into v_manifest from artifacts.manifests m where m.upload_id = p_upload_id;
  if found then
    v_result.root := v_manifest.root;
    v_result.manifest_id := v_manifest.id;
    v_result.outcome := case when v_manifest.root = p_root then 'exists' else 'root_mismatch' end;
    return v_result;
  end if;

  if v_lease.state <> 'complete' then
    v_result.outcome := 'not_complete';
    return v_result;
  end if;
  if v_lease.expires_at <= clock_timestamp() then
    v_result.outcome := 'expired';
    return v_result;
  end if;
  if not exists (select 1 from artifacts.attachment_transforms t where t.name = p_transform) then
    v_result.outcome := 'transform_unknown';
    return v_result;
  end if;
  v_stripped := p_transform = 'strip-picture-metadata';
  -- The strip is for pictures: a file has no metadata segment to remove, and the retained quota counts pictures.
  if v_stripped and v_lease.kind <> 'picture' then
    v_result.outcome := 'transform_unknown';
    return v_result;
  end if;
  if encode(sha256(convert_to(p_body, 'UTF8')), 'hex') <> p_root then
    v_result.outcome := 'root_mismatch';
    return v_result;
  end if;

  -- The digest and length the manifest describes: the lease's for every other transform, and for the strip the stripped copy's, read out of the body (a
  -- value the body does not hold in exactly the canonical spelling is a body that is not the canonical text).
  if v_stripped then
    v_digest := substring(p_body from '"digest":"([0-9a-f]{64})"');
    v_length := substring(p_body from '"length":([1-9][0-9]{0,8}),')::bigint;
    if v_digest is null or v_length is null or v_length < 1 or v_length > v_lease.length + 4096 then
      v_result.outcome := 'body_mismatch';
      return v_result;
    end if;
  else
    v_digest := v_lease.sha256;
    v_length := v_lease.length;
  end if;

  -- The body this lease's manifest has, as RFC 8785 writes it. Every part is ASCII that needs no escape (the transform name, the kind and the digest are
  -- checked by pattern or by a closed list, the IDs are UUIDs, the length is a whole number), so the text is built here and compared whole.
  v_expected := '{"activity":"upload:' || p_transform || '","children":[],"digest":"' || v_digest || '","id":"' || p_upload_id::text
    || '","kind":"' || v_lease.kind || '","length":' || v_length::text || ',"scope":"' || p_account_id::text || '","serialization":1}';
  if p_body <> v_expected then
    v_result.outcome := 'body_mismatch';
    return v_result;
  end if;

  -- The retained quota: this Account's kept pictures (the sum of the length of its manifests of kind `picture`) plus this one must not pass 2 GiB. The sum is
  -- read under a lock of the Account's own, so two confirmations at the edge are serial and the second is refused. (The application's pre-check is the first
  -- line; this is the backstop for the race.)
  if v_stripped then
    perform pg_advisory_xact_lock(hashtextextended('nova3d:retained:' || p_account_id::text, 0));
    select coalesce(sum(m.length), 0) into v_kept from artifacts.manifests m where m.account_id = p_account_id and m.kind = 'picture';
    if v_kept + v_length > 2147483648 then
      v_result.outcome := 'quota_exceeded';
      return v_result;
    end if;
  end if;

  insert into artifacts.manifests (root, id, account_id, upload_id, kind, digest, length, serialization, activity, body)
    values (p_root, p_upload_id, p_account_id, p_upload_id, v_lease.kind, v_digest, v_length, 1, 'upload:' || p_transform, p_body);
  update artifacts.staging_leases l set state = 'attached' where l.id = p_upload_id;

  v_result.outcome := 'published';
  v_result.root := p_root;
  v_result.manifest_id := p_upload_id;
  return v_result;
end;
$$;

comment on function artifacts.publish_attachment(uuid, bigint, uuid, text, text, text) is
  'The one writer of a manifest: asserts the operation''s authority, checks the lease is complete, unexpired and the Account''s own, the transform registered, the root the SHA-256 of the body and the body exactly the canonical text of this lease''s manifest, then inserts the immutable manifest and marks the lease attached, once. For the transform strip-picture-metadata (a picture lease only) the manifest''s digest and length are the stripped copy''s (read out of the canonical body, the length from 1 to the lease''s plus 4,096), and the Account''s retained pictures plus this one must not pass 2 GiB (quota_exceeded, under the advisory lock nova3d:retained:<account>). published | exists | denied | not_found | not_complete | expired | transform_unknown | root_mismatch | body_mismatch | quota_exceeded.';

-- The retained-picture resolver's view ----------------------------------------------------------------------------------------------------

-- What the gateway's resolver of the kind `retained` reads before every chunk of a download (workers/files/src/resolvers.ts). A retained picture is served only
-- while it is PINNED by a revision of a live Project of the same Account: the Project is not deleted and has no tombstone. (The Account's own liveness is the
-- session's, artifacts.session_authority, asked before the resolver for every transfer.) The target's ID is the upload's, which is its manifest's ID too.
-- Like artifacts.session_authority it calls no function of another schema (Postgres checks the right to execute a function as the CALLER, not as the view's
-- owner), so the tombstone test is written out as an anti-join over the table the guard reads, and the gateway holds no privilege on projects or lifecycle.
-- One row per upload: a picture that several revisions pin (a successor carries the pins of the pictures it did not change) is one row.
create view artifacts.retained_pictures as
  select distinct i.account_id, i.upload_id, m.root, m.digest, m.length, i.content_type
    from projects.request_images i
    join projects.projects p on p.id = i.project_id and p.account_id = i.account_id and p.deleted_at is null
    join artifacts.manifests m on m.upload_id = i.upload_id and m.account_id = i.account_id and m.kind = 'picture' and m.root = i.retained_root
   where i.retained_root is not null
     and not exists (select 1 from lifecycle.tombstones t where t.kind = 'project' and t.target_id = p.id);

comment on view artifacts.retained_pictures is
  'One row per retained picture that a revision of a live Project (not deleted, not tombstoned) of the same Account pins: Account, upload (= manifest ID), root, retained digest and length, content type. Read-only; the gateway''s resolver of the kind retained reads it before every chunk.';

revoke all on artifacts.retained_pictures from public, anon, authenticated, service_role;
grant select on artifacts.retained_pictures to nova3d_gateway;

-- The pre-check ---------------------------------------------------------------------------------------------------------------------------

-- `position` is the one the answer is about (unknown_upload, not_ready, expired_upload); `seq` is the latest revision's, for `stale`; `kept` and `asked` are the
-- bytes of the Account's retained pictures and the bytes of the staged copies still to be kept, for `quota_exceeded`; `pictures` is, for `checked`,
-- [{position, upload_id, action, root}] in position order with `action` `attach` (no manifest yet; `root` null) or `retained` (a manifest of that upload exists).
create type api.picture_retention_check as (outcome text, seq integer, position integer, kept bigint, asked bigint, pictures jsonb);

-- Whether the pictures of a Project can be retained now, READ-ONLY (it takes no row lock of a Project and writes nothing). In order:
--   1. the arguments are checked (22023): 1 to 12 upload IDs, none repeated, none null; an expected `seq` of at least 1
--   2. identity.assert_operation_authority(account, epoch): a refusal (N3010) answers `denied`
--   3. the Project is the Account's own, not deleted and not tombstoned (`unavailable`: one answer for every case)
--   4. the latest revision's `seq` is `expected_seq`, it is a picture revision and its ordered uploads equal the supplied ones (`stale`, carrying the latest
--      `seq`); a text request, and a Project whose stage is no longer a request stage, are `not_editable`
--   5. each upload, read from `artifacts` as the owner, in position order: another Account's, unknown or not a picture is `unknown_upload`; one with a manifest is
--      `retained` whatever state its staged copy is in; otherwise a lease that is neither `complete` nor `attached` is `not_ready` and an expired one is
--      `expired_upload` (each with the position; the first problem by position wins)
--   6. the quota: the Account's retained pictures (the sum of `length` over its manifests of kind `picture`) plus the staged lengths of the uploads that have no
--      manifest yet must not exceed 2 GiB (2,147,483,648 bytes): `quota_exceeded` for the whole confirmation, with the bytes kept and the bytes asked
--   checked | denied | unavailable | stale | not_editable | unknown_upload | not_ready | expired_upload | quota_exceeded
create function api.check_picture_retention(p_account_id uuid, p_epoch bigint, p_project_id uuid, p_expected_seq integer, p_upload_ids uuid[])
returns api.picture_retention_check
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_result api.picture_retention_check;
  v_stage text;
  v_latest projects.request_revisions;
  v_current uuid[];
  v_row record;
  v_kept bigint;
  v_asked bigint := 0;
  v_pictures jsonb := '[]'::jsonb;
begin
  if p_account_id is null or p_epoch is null or p_epoch < 1 or p_project_id is null or p_expected_seq is null or p_expected_seq < 1
     or p_upload_ids is null or array_ndims(p_upload_ids) is distinct from 1 or array_lower(p_upload_ids, 1) <> 1
     or cardinality(p_upload_ids) not between 1 and 12
     or array_position(p_upload_ids, null) is not null
     or (select count(distinct x.id) from unnest(p_upload_ids) as x(id)) <> cardinality(p_upload_ids) then
    raise exception 'invalid argument' using errcode = '22023';
  end if;

  begin
    perform identity.assert_operation_authority(p_account_id, p_epoch);
  exception when sqlstate 'N3010' then
    v_result.outcome := 'denied';
    return v_result;
  end;

  select p.stage into v_stage
    from projects.projects p
   where p.id = p_project_id and p.account_id = p_account_id and p.deleted_at is null
     and not lifecycle.is_tombstoned('project', p.id);
  if not found then
    v_result.outcome := 'unavailable';
    return v_result;
  end if;

  select * into v_latest from projects.request_revisions r where r.project_id = p_project_id order by r.seq desc limit 1;
  if not found then
    v_result.outcome := 'stale';
    return v_result;
  end if;
  if v_latest.mode = 'evidence_text' or v_stage not in ('request_draft', 'request_confirmed') then
    v_result.outcome := 'not_editable';
    return v_result;
  end if;
  v_result.seq := v_latest.seq;
  select coalesce(array_agg(i.upload_id order by i.position), '{}') into v_current from projects.request_images i where i.revision_id = v_latest.id;
  if v_latest.seq <> p_expected_seq or v_current <> p_upload_ids then
    v_result.outcome := 'stale';
    return v_result;
  end if;
  v_result.seq := null;

  for v_row in
    select u.position, l.account_id, l.kind, l.state, l.expires_at, l.length, m.root
      from generate_series(1, cardinality(p_upload_ids)) as u(position)
      left join artifacts.staging_leases l on l.id = p_upload_ids[u.position]
      left join artifacts.manifests m on m.upload_id = l.id and m.account_id = p_account_id and m.kind = 'picture'
     order by u.position
  loop
    v_result.position := v_row.position;
    if v_row.account_id is distinct from p_account_id or v_row.kind is distinct from 'picture' then
      v_result.outcome := 'unknown_upload';
      return v_result;
    end if;
    if v_row.root is null then
      if v_row.state not in ('complete', 'attached') then
        v_result.outcome := 'not_ready';
        return v_result;
      end if;
      if v_row.expires_at <= clock_timestamp() then
        v_result.outcome := 'expired_upload';
        return v_result;
      end if;
      v_asked := v_asked + v_row.length;
    end if;
    v_pictures := v_pictures || jsonb_build_array(jsonb_build_object(
      'position', v_row.position,
      'upload_id', p_upload_ids[v_row.position],
      'action', case when v_row.root is null then 'attach' else 'retained' end,
      'root', v_row.root));
  end loop;
  v_result.position := null;

  select coalesce(sum(m.length), 0) into v_kept from artifacts.manifests m where m.account_id = p_account_id and m.kind = 'picture';
  if v_kept + v_asked > 2147483648 then
    v_result.outcome := 'quota_exceeded';
    v_result.kept := v_kept;
    v_result.asked := v_asked;
    return v_result;
  end if;

  v_result.outcome := 'checked';
  v_result.pictures := v_pictures;
  return v_result;
end;
$$;

comment on function api.check_picture_retention(uuid, bigint, uuid, integer, uuid[]) is
  'The read-only pre-check of retaining the pictures of a Project (Story 2.12): the Account''s authority (denied), the Project (unavailable, one answer), the latest revision being the expected one and holding exactly these uploads in this order (stale; not_editable for a text request or a Project past the request stages), every upload read from artifacts (unknown_upload, not_ready, expired_upload with the position; an upload with a manifest is retained whatever its staged copy), and the 2 GiB retained quota over the Account''s kept pictures plus the staged lengths still to keep (quota_exceeded with the bytes kept and asked). checked answers, per position, attach (no manifest yet) or retained (with its root). Writes nothing.';

-- Appending pictures to an unconfirmed picture Project ---------------------------------------------------------------------------------

-- As 20261020120000_picture_review.sql defined it, with these changes (marked Story 2.12 below): an upload whose picture manifest exists is accepted whatever the
-- state of its staged copy (an `attached` lease, or one the cleanup has since released or deleted) and its pins are carried into the successor; the leases that
-- are renewed are the `complete` ones (a retained picture's staged copy is not given a new life, and a `deleted` lease is final).
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
  -- Story 2.12: an upload whose picture manifest exists is a RETAINED picture. It is accepted whatever the state of its staged copy (the lease is `attached`, or
  -- the cleanup has released or deleted it since), because what it is now is the manifest; every other upload is judged by its lease as before.
  perform 1 from artifacts.staging_leases l where l.id = any(p_upload_ids) order by l.id for update;
  for v_row in
    select u.position, l.account_id, l.kind, l.state, l.expires_at, l.length, l.sha256, (m.root is not null) as retained
      from generate_series(1, cardinality(p_upload_ids)) as u(position)
      left join artifacts.staging_leases l on l.id = p_upload_ids[u.position]
      left join artifacts.manifests m on m.upload_id = l.id and m.account_id = p_account_id and m.kind = 'picture'
     order by u.position
  loop
    v_result.position := v_row.position;
    if v_row.account_id is distinct from p_account_id or v_row.kind is distinct from 'picture' then
      v_result.outcome := 'unknown_upload';
      return v_result;
    end if;
    if not v_row.retained then
      if v_row.state <> 'complete' then
        v_result.outcome := 'not_ready';
        return v_result;
      end if;
      if v_row.expires_at <= clock_timestamp() then
        v_result.outcome := 'expired_upload';
        return v_result;
      end if;
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
       where l.id = any(p_upload_ids) and l.state = 'complete';
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

  -- Story 2.12: a retained picture carries its pins into the successor (the manifest is the upload's, so the pins are the same ones, whatever revision they
  -- were first recorded in); a staged one has none.
  insert into projects.request_images (revision_id, project_id, account_id, position, upload_id, sha256, length, content_type, retained_root, retained_sha256, retained_length)
    select v_request_id, v_project_id, p_account_id, u.position, p_upload_ids[u.position], l.sha256, l.length, l.content_type, m.root, m.digest, m.length::integer
      from generate_series(1, cardinality(p_upload_ids)) as u(position)
      join artifacts.staging_leases l on l.id = p_upload_ids[u.position]
      left join artifacts.manifests m on m.upload_id = l.id and m.account_id = p_account_id and m.kind = 'picture'
     order by u.position;

  -- The leases of the set last another 24 hours from now, and never longer than 7 days from when they were created. (A retained picture's lease is not
  -- renewed: its staged copy is expiring, and a deleted lease is final.)
  update artifacts.staging_leases l
     set expires_at = least(clock_timestamp() + interval '24 hours', l.created_at + interval '7 days')
   where l.id = any(p_upload_ids) and l.state = 'complete';

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
  'Records an ordered set of staged pictures as an unconfirmed request revision: creates the Project (stage request_draft, revision 1) and revision 1 when the Project ID is null, or appends a successor (seq + 1, the Project''s revision raised by one) to a Project whose latest revision is an unconfirmed picture revision of either mode (a reviewed revision is superseded by an unreviewed successor, whose pictures carry no labels). Reads each upload from its lease, except that an upload whose picture manifest exists (a retained picture, Story 2.12) is accepted whatever the state of its staged copy and carries its pins (root, retained SHA-256 and length) into the successor; enforces 1 to 12 pictures and 60 MiB; renews the complete leases to the earlier of 24 hours from now and 7 days from their creation; releases the uploads that left the set. created | revised | unchanged (nothing recorded and nothing released, but the included complete leases are renewed within the same bound) | replayed | reused | unavailable | not_editable | unknown_upload | not_ready | expired_upload | duplicate_image (two different uploads whose leases hold the same SHA-256; each of these four with the position, the first problem by position winning) | too_large | denied. Begins, after its argument checks (22023), with identity.assert_operation_authority.';

-- Recording a review ------------------------------------------------------------------------------------------------------------

-- As 20261020120000_picture_review.sql defined it (the same signature, the same command digest, so a replay is the same receipt), with these changes (marked
-- Story 2.12 below):
--   * every upload must have a manifest (`not_retained` at the position): the application retains the pictures first, and the database refuses a review of
--     pictures that were not. An `attached` lease is accepted when its manifest exists (and so is a lease whose staged copy has since gone);
--   * the writer pins what was published: for each upload it takes root, digest and length from the Account's manifest of kind `picture` (never from the browser);
--   * an identical re-confirmation (`unchanged`) also requires that the latest revision already pins the same roots;
--   * on commit the pinned leases' `expires_at` is set to the database clock, so the hourly cleanup deletes the staged copies.
create or replace function api.record_picture_review(
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

  -- 6. Every upload, from its lease and its manifest, again. The rows are locked first, in one order, so a release or a renewal made meanwhile is seen.
  -- Story 2.12: every upload must be RETAINED (it has a manifest of kind `picture`); the writer pins the manifests, so a review of pictures that were not
  -- retained is `not_retained` at the first such position. An upload with a manifest is accepted whatever the state of its staged copy (`attached`, or gone
  -- since); one without is judged by its lease first, as before (`not_ready`, `expired_upload`), and is `not_retained` when it is complete and unexpired.
  perform 1 from artifacts.staging_leases l where l.id = any(v_upload_ids) order by l.id for update;
  for v_row in
    select u.position, l.account_id, l.kind, l.state, l.expires_at, (m.root is not null) as retained
      from generate_series(1, cardinality(v_upload_ids)) as u(position)
      left join artifacts.staging_leases l on l.id = v_upload_ids[u.position]
      left join artifacts.manifests m on m.upload_id = l.id and m.account_id = p_account_id and m.kind = 'picture'
     order by u.position
  loop
    v_result.position := v_row.position;
    if v_row.account_id is distinct from p_account_id or v_row.kind is distinct from 'picture' then
      v_result.outcome := 'unknown_upload';
      return v_result;
    end if;
    if not v_row.retained then
      if v_row.state not in ('complete', 'attached') then
        v_result.outcome := 'not_ready';
        return v_result;
      end if;
      if v_row.expires_at <= clock_timestamp() then
        v_result.outcome := 'expired_upload';
        return v_result;
      end if;
      v_result.outcome := 'not_retained';
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
  -- pictures in the same order with the same labels, measurements and (Story 2.12) PINS, and the same acknowledgment state (a lost answer, then Confirm
  -- pressed again after a reload, under a new command ID). Nothing is recorded and the Project is not touched, but the staged copies are set to expire as a
  -- recorded review would set them (the pictures are retained, so nothing is renewed).
  v_same := v_latest.mode = p_mode
    and v_latest.scope is not distinct from p_scope
    and v_latest.outcome is not distinct from p_outcome
    and (v_latest.confirmed_at is not null) = v_direct
    and v_latest.obstruction_confirmed_at is not null
    and (v_latest.incomplete_acknowledged_at is not null) = v_incomplete
    and (select count(*)
           from jsonb_array_elements(p_images) with ordinality as e(value, position)
           join projects.request_images i on i.revision_id = v_latest.id and i.position = e.position
           join artifacts.manifests m on m.upload_id = i.upload_id and m.account_id = p_account_id and m.kind = 'picture'
          where i.upload_id = (e.value ->> 'upload_id')::uuid
            and i.retained_root = m.root and i.retained_sha256 = m.digest and i.retained_length = m.length
            and i.view_label is not distinct from (e.value ->> 'label')
            and i.short_edge_px = (e.value ->> 'short_edge_px')::integer
            and i.blur_variance = (e.value ->> 'blur_variance')::numeric
            and i.clipped_fraction = (e.value ->> 'clipped_fraction')::numeric) = jsonb_array_length(p_images);
  if v_same then
    update artifacts.staging_leases l
       set expires_at = clock_timestamp()
     where l.id = any(v_upload_ids) and l.state = 'attached' and l.expires_at > clock_timestamp();
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

  -- Story 2.12: the pictures are pinned. The staged SHA-256 and length are the lease's (what the person confirmed); the root, retained digest and retained
  -- length are the Account's manifest's for the upload, read here and never taken from the browser.
  insert into projects.request_images (
    revision_id, project_id, account_id, position, upload_id, sha256, length, content_type, view_label, short_edge_px, blur_variance, clipped_fraction,
    retained_root, retained_sha256, retained_length
  )
    select v_request_id, p_project_id, p_account_id, e.position, (e.value ->> 'upload_id')::uuid, l.sha256, l.length, l.content_type,
           e.value ->> 'label', (e.value ->> 'short_edge_px')::integer, (e.value ->> 'blur_variance')::numeric, (e.value ->> 'clipped_fraction')::numeric,
           m.root, m.digest, m.length::integer
      from jsonb_array_elements(p_images) with ordinality as e(value, position)
      join artifacts.staging_leases l on l.id = (e.value ->> 'upload_id')::uuid
      join artifacts.manifests m on m.upload_id = l.id and m.account_id = p_account_id and m.kind = 'picture'
     order by e.position;

  -- The staged copies expire now: the pictures are kept, and the hourly cleanup of Story 1.12 deletes a staged copy whose lease has lapsed. (Only a lease that
  -- is still `attached` and unexpired is moved; one the cleanup has released or deleted already is left alone, a deleted lease being final.)
  update artifacts.staging_leases l
     set expires_at = clock_timestamp()
   where l.id = any(v_upload_ids) and l.state = 'attached' and l.expires_at > clock_timestamp();

  v_result.outcome := 'created';
  v_result.project_id := p_project_id;
  v_result.request_id := v_request_id;
  v_result.seq := v_latest.seq + 1;
  return v_result;
end;
$$;

comment on function api.record_picture_review(uuid, bigint, uuid, uuid, integer, text, text, text, jsonb, boolean, boolean) is
  'Records the review of a Project''s pictures as a successor request revision (seq + 1, the Project''s revision raised by one): the mode (evidence_images, research-assisted, unconfirmed, stage request_draft; or image_direct, confirmed with the scope and outcome and no subject, stage request_confirmed), the person''s labels and the browser''s measurements of each picture (claims, stored as sent), that the person confirmed nothing blocks the subject, and, for image_direct with incomplete inputs (recomputed here), the Generate anyway acknowledgment with its time and the digest of the scope and the ordered pictures. Story 2.12: every picture must already be retained (a manifest of kind picture exists for its upload), and the writer pins the ordered pictures from artifacts.manifests (root, retained SHA-256 and length beside the staged SHA-256 the person confirmed; never from the browser) and sets the pinned leases to expire now so the staged copies are cleaned up. created | replayed | unchanged (the latest revision already holds exactly this review and the same pins: nothing is recorded) | stale (the latest revision is not the one reviewed; carries its seq) | reused | unavailable | not_editable (a text request, or a Project whose stage is not request_draft or request_confirmed) | unknown_upload | not_ready | expired_upload | not_retained (each with the position) | obstruction_not_confirmed | acknowledgment_required | denied. Begins, after its argument checks (22023), with identity.assert_operation_authority. Starts no conversion, approves no plan and authorizes no cost.';

-- Reading the request -----------------------------------------------------------------------------------------------------------------

-- As 20261020120000_picture_review.sql defined it, with one change: a picture is `available` while its upload is complete and unexpired, or its staged copy is
-- `attached` and unexpired (the staging resolver serves both), or - Story 2.12 - it is PINNED (its retained copy is served by the resolver of the kind
-- `retained`). The type is unchanged, and so is the key list of an image: the retained facts are read through api.read_retained_pictures.
create or replace function api.read_project_request(p_account_id uuid, p_epoch bigint, p_project_id uuid)
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
  -- A picture is available while its staged copy can be read (complete or attached, and unexpired) or it is pinned (its retained copy is served). The lease's
  -- state and expiry are read as the owner; no key of Storage and no address of an object is ever part of the answer.
  select coalesce(jsonb_agg(jsonb_build_object(
           'position', i.position,
           'upload_id', i.upload_id,
           'sha256', i.sha256,
           'length', i.length,
           'content_type', i.content_type,
           'expires_at', l.expires_at,
           'available', coalesce(i.retained_root is not null or (l.state in ('complete', 'attached') and l.expires_at > clock_timestamp()), false),
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
  'The latest request revision of a live Project of the Account, with whether it is confirmed, its pictures (position, upload ID, SHA-256, length, content type, expiry, whether the picture is still available - its staged copy can be read, or it is pinned as a retained picture - and the label and measurements of a reviewed picture) and the review of the revision (whether the person confirmed nothing blocks the subject, and whether they acknowledged incomplete inputs, with the times). found | none (a Project without a revision) | unavailable (another Account''s, deleted, tombstoned and unknown Projects, one answer with nothing in it) | denied. Begins with identity.assert_operation_authority.';

-- Reading the retained pictures --------------------------------------------------------------------------------------------------------

create type api.retained_pictures_view as (
  outcome text,
  -- [{position, upload_id, root, retained_sha256, retained_length, staged_sha256, label, content_type}] in position order; [] unless `found`.
  pictures jsonb
);

-- The pictures the latest revision of a Project of the Account pins, in the confirmed order, each with the manifest root, the retained digest and length and the
-- staged digest the person confirmed (so each retained digest maps to the original), and nothing else. A later consumer (subject identification, research,
-- conversion, recovery) reads the retained roots through this and never the lease-bounded staging. Another Account's, deleted, tombstoned and unknown Projects
-- are ONE answer. Reads only; no Storage key or address is part of the answer.
--   found | none (nothing is pinned) | unavailable | denied
create function api.read_retained_pictures(p_account_id uuid, p_epoch bigint, p_project_id uuid)
returns api.retained_pictures_view
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_result api.retained_pictures_view;
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
    v_result.pictures := '[]'::jsonb;
    return v_result;
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
           'position', i.position,
           'upload_id', i.upload_id,
           'root', i.retained_root,
           'retained_sha256', i.retained_sha256,
           'retained_length', i.retained_length,
           'staged_sha256', i.sha256,
           'label', i.view_label,
           'content_type', i.content_type
         ) order by i.position), '[]'::jsonb)
    into v_result.pictures
    from projects.request_images i
   where i.revision_id = v_revision.id and i.retained_root is not null;
  v_result.outcome := case when jsonb_array_length(v_result.pictures) = 0 then 'none' else 'found' end;
  return v_result;
end;
$$;

comment on function api.read_retained_pictures(uuid, bigint, uuid) is
  'The pictures the latest request revision of a live Project of the Account pins, in the confirmed order: position, upload ID, manifest root, retained SHA-256 and length, staged SHA-256, label and content type, and nothing else. found | none (nothing is pinned) | unavailable (another Account''s, deleted, tombstoned and unknown Projects, one answer) | denied. Begins with identity.assert_operation_authority. Reads only.';

-- The preflight -----------------------------------------------------------------------------------------------------------------------------

-- Everything api.preflight read before (20261020120000_picture_review.sql), plus what this story depends on: the retained pins of projects.request_images, the
-- artifacts.retained_pictures view and the two new functions (thirty-eight `api` functions in all, each executable by the service role). It checks the catalog
-- and executes none of them, reads at most one row of each table and writes nothing. The bucket check stays last.
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
      'api.read_retained_pictures(uuid,bigint,uuid)'
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
  'Reads identity.session_grants (including its CSRF columns), identity.accounts (including its status handle), identity.account_preferences, identity.step_up_nonces, identity.fresh_authentications (including source), identity.recovery_tokens, projects.projects, projects.project_commands, projects.request_revisions (including the review columns), projects.request_images (including the labels and measurements and the retained pins), lifecycle.tombstones, lifecycle.ledger_outbox, lifecycle.ledger_relay, lifecycle.status_requests, lifecycle.job_receipts, the six artifacts tables and the artifacts.session_authority, artifacts.instance and artifacts.retained_pictures views, lifecycle.alarms, lifecycle.alarm_notices, lifecycle.heartbeats, auth.sessions, auth.identities and auth.mfa_amr_claims (one row each at most), checks that the Story 1.5, 1.6, 1.7, 1.8, 1.9, 1.12, 1.13, 2.1, 2.2, 2.3 and 2.12 functions exist and are executable by the service role, that the private-files bucket exists and is private, and that the owner may delete from auth.sessions and auth.users, and answers ok. Read-only.';

-- Access ------------------------------------------------------------------------------------------------------------------------------------

-- Closed by default; only the service role is let in, by name. (create or replace keeps the grants api.preflight, api.record_picture_set, api.record_picture_review,
-- api.read_project_request and artifacts.publish_attachment already had.)
grant execute on function api.check_picture_retention(uuid, bigint, uuid, integer, uuid[]) to service_role;
grant execute on function api.read_retained_pictures(uuid, bigint, uuid) to service_role;

-- New functions and types: have the Data API reload its schema cache now.
notify pgrst, 'reload schema';
