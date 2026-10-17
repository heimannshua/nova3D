-- Story 1.12: the file gateway's database.
--
-- A user's file never crosses a Vercel function. It goes to workers/files (a Node gateway on Railway), which is authorized by an
-- application-signed single-use ticket (lib/service-signing.ts) and by a LIVE read of Postgres before every chunk of at most 1 MiB, under its
-- own database role and its own Storage key. This file is the database half: the Artifacts-owned records, the role, the two authorization
-- views, the private bucket, the one function the gateway may execute, the two the application's service role may call, and the preflight.
--
--   artifacts (schema)               NOT exposed by the Data API. Owns, each closed (row-level security on, every privilege revoked from public, anon,
--                                    authenticated and service_role, default-privilege revokes for the schema, and no policy except the seven below,
--                                    each `to nova3d_gateway` only, on the three tables that role uses):
--     staging_leases                 one mutable row per upload: its Account, the key that opened it, kind (`picture` | `file`), declared length,
--                                    SHA-256 and content type, how much arrived, and its state: `receiving` -> `complete` -> `attached`, or
--                                    `released` (failed, revoked or expired) -> `deleted` (its staging object is gone). A lease lasts 24 hours and
--                                    activity renews it. The Account's OPEN staging (receiving and complete, unexpired) is at most 250 MiB.
--     ticket_redemptions             append-only: a ticket or a command is redeemed by inserting its `jti` (the primary key, so a replay
--                                    fails) with the Account, the session grant, the direction, the target, the issuer, the key ID and its expiry.
--                                    A BEFORE INSERT trigger refuses a revoked key, because the gateway role may not read the revocations.
--     transfer_handles               a transfer handle: 32 random bytes of which only the SHA-256 is stored, bound to the session grant, the Account,
--                                    the epoch, the target, the direction and the key, for at most 30 minutes. Every redeemed ticket opens one; it is
--                                    internal unless the browser-native download hands it out. Ended (not deleted) by a key revocation.
--     manifests                      append-only: the immutable manifest of an attached file: its canonical JSON body (RFC 8785, lib/canonical-json.ts)
--                                    and its root, the SHA-256 of that body.
--     attachment_transforms          the names of the registered transforms. `none` only: Story 2.12 registers the metadata strip.
--     service_key_revocations        append-only: (issuer, key ID, reason, time). A revoked key is refused everywhere at once.
--   artifacts.session_authority      view: one row per session grant, with the same liveness api.authorize_session answers (tombstoned Account,
--                                    disabled, no Auth session, revoked, expired at 30 days, idle at 7, stale epoch, subject mismatch, active). It never
--                                    writes (authorize_session touches the grant's last use and revokes on a subject mismatch; the view does neither).
--   artifacts.instance               view: the environment and instance ID of this database, which the gateway verifies at start-up.
--   artifacts.publish_attachment     the ONE writer of a manifest. It asserts the operation's authority in the transaction of the write, checks the lease
--                                    is `complete`, not expired and the Account's own, the transform registered, the root the SHA-256 of the body and the
--                                    body exactly the canonical text (RFC 8785) of this lease's manifest, inserts the manifest and marks the lease
--                                    `attached`, once (a repeat returns the same manifest).
--   nova3d_gateway (role)            login, no password here (supabase/seed.sql sets the local one, the hosted one is set by hand). It holds usage on
--                                    `artifacts`; select on the two views; insert and select on ticket_redemptions and transfer_handles; insert and
--                                    select on staging_leases with update on its progress columns only (received_length, state, expires_at); execute
--                                    on artifacts.publish_attachment. Nothing else: no api, identity, projects or lifecycle object.
--                                    A table with row-level security on admits a role that is not its owner and does not bypass row security only
--                                    through a policy, and this role is neither (giving it BYPASSRLS would need that attribute in the database owner too,
--                                    which a hosted project may not allow and which cannot be checked from here), so the three tables it reads and writes
--                                    carry one policy for each command it is granted, `to nova3d_gateway` ONLY: they open exactly what the grants
--                                    name (the spec was amended to say so), and every other role still meets a closed table.
--                                    Its limits are set on the role itself, not as startup parameters, so a pooler in transaction mode accepts them:
--                                    statement_timeout and idle_in_transaction_session_timeout of 15 seconds, and 20 connections at most.
--   api.revoke_service_key           writes the revocation and, in the same transaction, ends every staging lease and transfer handle opened under the key.
--   api.list_expired_staging         names the leases the hourly cleanup removes (expired or released, not yet deleted), at most 50.
--   api.preflight                    re-created carrying every earlier probe and the new ones.
--
-- The private bucket `private-files` (private, created below through storage.buckets) holds `staging/<account>/<upload>` and
-- `objects/<account>/<root>` (the manifest root, the SHA-256 of the canonical body, which holds the upload's own ID: every attach has a key of its own). A user-data bucket is never public; the gateway's Storage S3 key bypasses row policies, which is why only the
-- gateway holds one and why no policy on storage.objects is created for this bucket.
--
-- Stable error code:
--   N3040  a ticket or command is redeemed under a key that has been revoked (the redemption is refused)

-- The schema, closed by default -----------------------------------------------------------------------------------------------------

create schema artifacts;

comment on schema artifacts is 'Story 1.12. Staging leases, ticket redemptions, transfer handles, manifests. Not exposed; reached by the file gateway role and by api functions.';

revoke all on schema artifacts from public, anon, authenticated, service_role;

alter default privileges for role postgres in schema artifacts revoke execute on functions from public, anon, authenticated, service_role;
alter default privileges for role postgres in schema artifacts revoke all on tables from public, anon, authenticated, service_role;
alter default privileges for role postgres in schema artifacts revoke all on sequences from public, anon, authenticated, service_role;

create function artifacts.refuse_change() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception '% is append-only', tg_table_schema || '.' || tg_table_name using errcode = '55000';
end;
$$;

-- Revocations -----------------------------------------------------------------------------------------------------------------------

create table artifacts.service_key_revocations (
  issuer text not null check (issuer in ('application', 'gateway', 'cad-worker', 'engine-worker', 'backup-service', 'heartbeat')),
  kid text not null check (kid ~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$'),
  reason text not null check (reason ~ '^[a-z][a-z0-9_]{0,39}$'),
  revoked_at timestamptz not null default clock_timestamp(),
  primary key (issuer, kid)
);

comment on table artifacts.service_key_revocations is
  'One row per revoked service-signing key (issuer, key ID, reason, time). Never updated, deleted or truncated. Written only by api.revoke_service_key.';

create trigger service_key_revocations_no_change before update or delete on artifacts.service_key_revocations
  for each row execute function artifacts.refuse_change();
create trigger service_key_revocations_no_truncate before truncate on artifacts.service_key_revocations
  for each statement execute function artifacts.refuse_change();

-- Staging leases ---------------------------------------------------------------------------------------------------------------------

create table artifacts.staging_leases (
  -- The upload ID: chosen by the caller (a UUID), and taken once: a second PUT with it, by anyone, is refused.
  id uuid primary key,
  account_id uuid not null,
  -- The key (of the application) whose ticket opened the lease: a revocation of that key ends the lease.
  kid text not null check (kid ~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$'),
  kind text not null check (kind in ('picture', 'file')),
  length bigint not null check (length >= 1 and length <= 104857600),
  sha256 text not null check (sha256 ~ '^[0-9a-f]{64}$'),
  content_type text not null check (content_type in ('image/jpeg', 'image/png', 'image/webp', 'application/octet-stream')),
  received_length bigint not null default 0 check (received_length >= 0),
  state text not null default 'receiving' check (state in ('receiving', 'complete', 'attached', 'released', 'deleted')),
  created_at timestamptz not null default clock_timestamp(),
  expires_at timestamptz not null,
  check (received_length <= length),
  check (state not in ('complete', 'attached') or received_length = length),
  -- A picture is at most 12 MiB and one of three types; any other file is one type and at most 100 MiB.
  check (kind <> 'picture' or (length <= 12582912 and content_type in ('image/jpeg', 'image/png', 'image/webp'))),
  check (kind <> 'file' or content_type = 'application/octet-stream')
);

comment on table artifacts.staging_leases is
  'One row per upload: Account, opening key, kind, declared length, SHA-256 and content type, progress and state (receiving, complete, attached, released, deleted). 24 hours, renewed by activity.';

-- The Account's open staging is summed for the quota; the cleanup lists what is expired or released.
create index staging_leases_open on artifacts.staging_leases (account_id) where state in ('receiving', 'complete');
create index staging_leases_cleanup on artifacts.staging_leases (expires_at) where state <> 'deleted';
create index staging_leases_kid on artifacts.staging_leases (kid) where state in ('receiving', 'complete');

-- What a lease is can never change; only its progress moves, and its state only forward:
--   receiving -> complete | released     complete -> attached | released     attached -> released     released -> deleted
-- A deleted lease is final. Bytes received only rise, and only while receiving.
create function artifacts.guard_lease() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.id <> old.id or new.account_id <> old.account_id or new.kid <> old.kid or new.kind <> old.kind or new.length <> old.length
     or new.sha256 <> old.sha256 or new.content_type <> old.content_type or new.created_at <> old.created_at then
    raise exception 'a staging lease is immutable apart from its progress' using errcode = '55000';
  end if;
  if old.state = 'deleted' then
    raise exception 'a deleted staging lease is final' using errcode = '55000';
  end if;
  if new.received_length < old.received_length or (new.received_length <> old.received_length and old.state <> 'receiving') then
    raise exception 'a staging lease receives bytes only while receiving, and the count only rises' using errcode = '55000';
  end if;
  if new.state <> old.state and not (
       (old.state = 'receiving' and new.state in ('complete', 'released'))
    or (old.state = 'complete' and new.state in ('attached', 'released'))
    or (old.state = 'attached' and new.state = 'released')
    or (old.state = 'released' and new.state = 'deleted')) then
    raise exception 'a staging lease cannot go from % to %', old.state, new.state using errcode = '55000';
  end if;
  return new;
end;
$$;

create trigger staging_leases_guard before update on artifacts.staging_leases
  for each row execute function artifacts.guard_lease();
create trigger staging_leases_no_delete before delete on artifacts.staging_leases
  for each row execute function artifacts.refuse_change();
create trigger staging_leases_no_truncate before truncate on artifacts.staging_leases
  for each statement execute function artifacts.refuse_change();

-- Ticket redemptions ------------------------------------------------------------------------------------------------------------------

create table artifacts.ticket_redemptions (
  -- The token's `jti` (128 random bits, base64url): the primary key is what makes a ticket single-use.
  jti text primary key check (jti ~ '^[A-Za-z0-9_-]{22}$'),
  typ text not null check (typ in ('ticket', 'command')),
  issuer text not null check (issuer in ('application', 'gateway', 'cad-worker', 'engine-worker', 'backup-service', 'heartbeat')),
  kid text not null check (kid ~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$'),
  account_id uuid not null,
  -- A ticket names the session grant it was issued for and the direction; a command names neither.
  session_id uuid,
  direction text check (direction in ('upload', 'download')),
  -- A ticket's target kind and ID; a command's name and the upload ID or root it is about.
  target_kind text not null check (target_kind ~ '^[a-z][a-z0-9-]{0,62}$'),
  target_id text not null check (target_id ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' or target_id ~ '^[0-9a-f]{64}$'),
  expires_at timestamptz not null,
  redeemed_at timestamptz not null default clock_timestamp(),
  check ((typ = 'ticket') = (session_id is not null and direction is not null)),
  check ((typ = 'command') = (session_id is null and direction is null))
);

comment on table artifacts.ticket_redemptions is
  'One row per redeemed ticket or command: jti (primary key), type, issuer, key ID, Account, session, direction, target and expiry. Never updated, deleted or truncated.';

create trigger ticket_redemptions_no_change before update or delete on artifacts.ticket_redemptions
  for each row execute function artifacts.refuse_change();
create trigger ticket_redemptions_no_truncate before truncate on artifacts.ticket_redemptions
  for each statement execute function artifacts.refuse_change();

-- A token signed by a revoked key is not redeemed, whatever else is right with it. The gateway role cannot read the revocations (it holds
-- nothing beyond its list), so the refusal is made here, in the owner's name, as part of the insert that redeems. The shared lock on the key
-- makes a redemption and a revocation serial: either the redemption (and the handle opened in its transaction) commits first, and the
-- revocation then ends that handle, or the revocation commits first and this refuses.
create function artifacts.guard_redemption() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform pg_advisory_xact_lock_shared(hashtextextended('nova3d:service-key:' || new.issuer || ':' || new.kid, 0));
  if exists (select 1 from artifacts.service_key_revocations r where r.issuer = new.issuer and r.kid = new.kid) then
    raise exception 'the signing key is revoked' using errcode = 'N3040';
  end if;
  return new;
end;
$$;

create trigger ticket_redemptions_guard before insert on artifacts.ticket_redemptions
  for each row execute function artifacts.guard_redemption();

-- Transfer handles ---------------------------------------------------------------------------------------------------------------------

create table artifacts.transfer_handles (
  -- SHA-256 of the 32 random bytes of the handle. The handle itself is never stored.
  hash bytea primary key check (octet_length(hash) = 32),
  -- The ticket this handle was opened by.
  jti text not null unique references artifacts.ticket_redemptions (jti),
  session_id uuid not null,
  account_id uuid not null,
  -- The Account's authorization epoch the ticket was issued under: a different current epoch ends the handle's authority.
  epoch bigint not null check (epoch >= 1),
  direction text not null check (direction in ('upload', 'download')),
  target_kind text not null check (target_kind ~ '^[a-z][a-z0-9-]{0,62}$'),
  target_id text not null check (target_id ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'),
  kid text not null check (kid ~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$'),
  created_at timestamptz not null default clock_timestamp(),
  -- At most 30 minutes from creation.
  expires_at timestamptz not null,
  ended_at timestamptz,
  check (expires_at > created_at and expires_at <= created_at + interval '30 minutes')
);

comment on table artifacts.transfer_handles is
  'A transfer handle: the SHA-256 of 32 random bytes, bound to a session grant, Account, epoch, target, direction and key, for at most 30 minutes. Ended by a key revocation; never deleted.';

create index transfer_handles_kid on artifacts.transfer_handles (kid) where ended_at is null;

-- A handle is what it was made as; the only change is being ended, once.
create function artifacts.guard_handle() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.hash <> old.hash or new.jti <> old.jti or new.session_id <> old.session_id or new.account_id <> old.account_id or new.epoch <> old.epoch
     or new.direction <> old.direction or new.target_kind <> old.target_kind or new.target_id <> old.target_id or new.kid <> old.kid
     or new.created_at <> old.created_at or new.expires_at <> old.expires_at then
    raise exception 'a transfer handle is immutable apart from being ended' using errcode = '55000';
  end if;
  if old.ended_at is not null or new.ended_at is null then
    raise exception 'a transfer handle is ended once' using errcode = '55000';
  end if;
  return new;
end;
$$;

create trigger transfer_handles_guard before update on artifacts.transfer_handles
  for each row execute function artifacts.guard_handle();
create trigger transfer_handles_no_delete before delete on artifacts.transfer_handles
  for each row execute function artifacts.refuse_change();
create trigger transfer_handles_no_truncate before truncate on artifacts.transfer_handles
  for each statement execute function artifacts.refuse_change();

-- Manifests and transforms -------------------------------------------------------------------------------------------------------------

create table artifacts.attachment_transforms (
  name text primary key check (name ~ '^[a-z][a-z0-9-]{0,62}$'),
  registered_at timestamptz not null default clock_timestamp()
);

comment on table artifacts.attachment_transforms is
  'The registered attachment transforms. `none` only; Story 2.12 registers the metadata strip.';

insert into artifacts.attachment_transforms (name) values ('none');

create trigger attachment_transforms_no_delete before delete on artifacts.attachment_transforms
  for each row execute function artifacts.refuse_change();
create trigger attachment_transforms_no_truncate before truncate on artifacts.attachment_transforms
  for each statement execute function artifacts.refuse_change();

create table artifacts.manifests (
  -- The manifest root: the SHA-256 (hex) of the canonical JSON body below, which an object key can never redefine.
  root text primary key check (root ~ '^[0-9a-f]{64}$'),
  id uuid not null unique,
  account_id uuid not null,
  -- The upload (lease) it was published from: one manifest each.
  upload_id uuid not null unique,
  kind text not null check (kind in ('picture', 'file')),
  digest text not null check (digest ~ '^[0-9a-f]{64}$'),
  length bigint not null check (length >= 1),
  serialization smallint not null check (serialization = 1),
  activity text not null check (activity ~ '^[a-z][a-z0-9:-]{0,127}$'),
  -- The RFC 8785 serialization as text: the bytes whose SHA-256 is the root (jsonb would reorder them).
  body text not null,
  created_at timestamptz not null default clock_timestamp(),
  check (root = encode(sha256(convert_to(body, 'UTF8')), 'hex'))
);

comment on table artifacts.manifests is
  'The immutable manifest of an attached file: id, Account, upload, kind, digest, length, serialization version, activity and its canonical JSON body; the root is the SHA-256 of the body. Never updated, deleted or truncated. Written only by artifacts.publish_attachment.';

create trigger manifests_no_change before update or delete on artifacts.manifests
  for each row execute function artifacts.refuse_change();
create trigger manifests_no_truncate before truncate on artifacts.manifests
  for each statement execute function artifacts.refuse_change();

-- Closed by default --------------------------------------------------------------------------------------------------------------------

alter table artifacts.service_key_revocations enable row level security;
alter table artifacts.staging_leases enable row level security;
alter table artifacts.ticket_redemptions enable row level security;
alter table artifacts.transfer_handles enable row level security;
alter table artifacts.attachment_transforms enable row level security;
alter table artifacts.manifests enable row level security;
-- No policy yet: only the owner and roles that bypass RLS can read a row, and the privileges below leave anon, authenticated and service_role no
-- path to the tables at all. The gateway role is let in further down, by grants AND by policies `to nova3d_gateway` alone on the three tables it uses.
revoke all on artifacts.service_key_revocations from public, anon, authenticated, service_role;
revoke all on artifacts.staging_leases from public, anon, authenticated, service_role;
revoke all on artifacts.ticket_redemptions from public, anon, authenticated, service_role;
revoke all on artifacts.transfer_handles from public, anon, authenticated, service_role;
revoke all on artifacts.attachment_transforms from public, anon, authenticated, service_role;
revoke all on artifacts.manifests from public, anon, authenticated, service_role;
revoke all on all functions in schema artifacts from public, anon, authenticated, service_role;

-- The authorization views -------------------------------------------------------------------------------------------------------------

-- The environment and instance of this database. The gateway reads it at start-up and exits when APP_ENV or INSTANCE_ID differ.
create view artifacts.instance as
  select i.environment, i.instance_id from lifecycle.instance_identity i;

comment on view artifacts.instance is 'The one row of lifecycle.instance_identity, for the gateway''s start-up check.';

-- One row per session grant, with the liveness api.authorize_session answers, in the same order of questions:
--   tombstoned      the Account has a tombstone (asked first, as the tombstone guard is, before anything else about the Account)
--   disabled        the Account is not active
--   no_session      Auth has no such session for the Account's user
--   subject_mismatch | revoked   the grant is revoked (for a changed Google identity, or for any other reason)
--   expired         issued at least 30 days ago
--   idle            last used at least 7 days ago
--   stale_epoch     issued under an older epoch than the Account's
--   subject_mismatch  the Account's pinned Google subject is no longer the user's one Google identity
--   active
-- The view runs as its owner for every TABLE it reads, so the gateway needs no privilege on them. It calls no function of identity or lifecycle
-- on purpose: Postgres checks the right to execute a function as the CALLER, not as the view's owner, so the tombstone test and the pinned-subject
-- test (identity.subject_pinned) are written out here as subqueries over the same tables, and the gateway holds no privilege on those schemas.
-- It writes nothing: authorize_session moves the grant's last use and revokes a grant whose subject changed; this does neither, and the next
-- request that reaches authorize_session does.
create view artifacts.session_authority as
  select g.session_id,
         a.id as account_id,
         a.authorization_epoch as epoch,
         case
           when exists (select 1 from lifecycle.tombstones t where t.kind = 'account' and t.target_id = a.id) then 'tombstoned'
           when a.status <> 'active' then 'disabled'
           when s.id is null then 'no_session'
           when g.revoked_at is not null then case when g.revoked_reason = 'subject_mismatch' then 'subject_mismatch' else 'revoked' end
           when g.issued_at <= clock_timestamp() - interval '30 days' then 'expired'
           when g.last_used_at <= clock_timestamp() - interval '7 days' then 'idle'
           when g.epoch < a.authorization_epoch then 'stale_epoch'
           when not coalesce(
                  (select count(*) = 1 and min(i.provider_id) = a.google_subject
                     from auth.identities i
                    where i.user_id = a.user_id and i.provider = 'google'),
                  false) then 'subject_mismatch'
           else 'active'
         end as state
    from identity.session_grants g
    join identity.accounts a on a.id = g.account_id
    left join auth.sessions s on s.id = g.session_id and s.user_id = a.user_id;

comment on view artifacts.session_authority is
  'One row per session grant with the liveness api.authorize_session answers (tombstoned, disabled, no_session, revoked, expired, idle, stale_epoch, subject_mismatch, active). Read-only: it writes nothing.';

revoke all on artifacts.instance from public, anon, authenticated, service_role;
revoke all on artifacts.session_authority from public, anon, authenticated, service_role;

-- Attaching a file ------------------------------------------------------------------------------------------------------------------------

create type artifacts.attachment_receipt as (outcome text, root text, manifest_id uuid);

-- The ONE writer of a manifest, run by the gateway after it has copied the verified object to `objects/<account>/<root>`. In one
-- transaction, under a lock on the lease:
--   1. the operation's authority is asserted FIRST (identity.assert_operation_authority: a tombstoned or disabled Account, or a stale epoch,
--      is `denied`), and holds the Account's row FOR SHARE, so a disable cannot commit between the check and the write;
--   2. the lease is the Account's own (`not_found` for another Account's, as for none);
--   3. a lease that is attached already answers `exists` with its manifest (a repeat returns the same manifest), or `root_mismatch`;
--   4. the lease is `complete` (`not_complete`) and has not expired (`expired`: a lease whose `expires_at` has passed is not attachable, because the
--      cleanup may be deleting its staging object), the transform is registered (`transform_unknown`);
--   5. the root is the SHA-256 of the body (`root_mismatch`) and the body IS, byte for byte, the canonical text (RFC 8785) of this lease's manifest
--      (`body_mismatch`): compact, the members in the order of RFC 8785 (activity, children, digest, id, kind, length, scope, serialization),
--      {"activity":"upload:<transform>","children":[],"digest":<SHA-256>,"id":<the upload ID>,"kind":<picture|file>,"length":<bytes>,
--       "scope":<the Account>,"serialization":1}, every string ASCII and every number a plain integer. Whitespace, another order of members, a repeated
--      member or any other spelling of the same data is refused, so a root can only ever be the hash of canonical bytes;
--   6. the manifest is inserted and the lease marked `attached`.
-- Anything refused writes nothing.
--   published | exists | denied | not_found | not_complete | expired | transform_unknown | root_mismatch | body_mismatch
create function artifacts.publish_attachment(p_account_id uuid, p_epoch bigint, p_upload_id uuid, p_transform text, p_root text, p_body text)
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
  if encode(sha256(convert_to(p_body, 'UTF8')), 'hex') <> p_root then
    v_result.outcome := 'root_mismatch';
    return v_result;
  end if;

  -- The body this lease's manifest has, as RFC 8785 writes it. Every part is ASCII that needs no escape (the transform name, the kind and the digest are
  -- checked by pattern or by a closed list, the IDs are UUIDs, the length is a whole number), so the text is built here and compared whole.
  v_expected := '{"activity":"upload:' || p_transform || '","children":[],"digest":"' || v_lease.sha256 || '","id":"' || p_upload_id::text
    || '","kind":"' || v_lease.kind || '","length":' || v_lease.length::text || ',"scope":"' || p_account_id::text || '","serialization":1}';
  if p_body <> v_expected then
    v_result.outcome := 'body_mismatch';
    return v_result;
  end if;

  insert into artifacts.manifests (root, id, account_id, upload_id, kind, digest, length, serialization, activity, body)
    values (p_root, p_upload_id, p_account_id, p_upload_id, v_lease.kind, v_lease.sha256, v_lease.length, 1, 'upload:' || p_transform, p_body);
  update artifacts.staging_leases l set state = 'attached' where l.id = p_upload_id;

  v_result.outcome := 'published';
  v_result.root := p_root;
  v_result.manifest_id := p_upload_id;
  return v_result;
end;
$$;

comment on function artifacts.publish_attachment(uuid, bigint, uuid, text, text, text) is
  'The one writer of a manifest: asserts the operation''s authority, checks the lease is complete, unexpired and the Account''s own, the transform registered, the root the SHA-256 of the body and the body exactly the canonical text of this lease''s manifest, then inserts the immutable manifest and marks the lease attached, once. published | exists | denied | not_found | not_complete | expired | transform_unknown | root_mismatch | body_mismatch.';

-- The gateway's role -----------------------------------------------------------------------------------------------------------------------

-- Roles belong to the cluster, not the database: one that exists already (a database reset keeps it) is reused. There is NO password here: a
-- password in a migration would be a secret in the repository. supabase/seed.sql sets the local one; a hosted one is set by hand
-- (docs/staging.md) and held only by the gateway service.
do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'nova3d_gateway') then
    create role nova3d_gateway login;
  end if;
end;
$$;

-- Limits of the role, as defaults of the ROLE and not as startup parameters of a connection (a pooler in transaction mode rejects some startup parameters
-- and holds no session in which a `set` could live): no statement runs longer than 15 seconds, no transaction sits idle longer than 15 seconds, and the
-- role holds at most 20 connections. The gateway's own client-side timeout stays.
alter role nova3d_gateway set statement_timeout = '15s';
alter role nova3d_gateway set idle_in_transaction_session_timeout = '15s';
alter role nova3d_gateway connection limit 20;

comment on role nova3d_gateway is 'Story 1.12. The file gateway (workers/files): the privileges listed in 20261015120000_file_gateway.sql and nothing else.';

-- (The default is a role with none of the powers: no superuser, no database or role creation, no replication, no bypass of row-level security.)
revoke all on all functions in schema artifacts from public, anon, authenticated, service_role;
grant usage on schema artifacts to nova3d_gateway;
grant select on artifacts.session_authority to nova3d_gateway;
grant select on artifacts.instance to nova3d_gateway;
grant select, insert on artifacts.ticket_redemptions to nova3d_gateway;
grant select, insert on artifacts.transfer_handles to nova3d_gateway;
grant select, insert on artifacts.staging_leases to nova3d_gateway;
grant update (received_length, state, expires_at) on artifacts.staging_leases to nova3d_gateway;
grant execute on function artifacts.publish_attachment(uuid, bigint, uuid, text, text, text) to nova3d_gateway;

-- The policies that let the role use what it was granted (see the header): one for each command, for this role only, true for every row, because the
-- grants above, not the policy, decide which commands and columns. No policy names any other role, and the tables the role may not touch have none.
create policy gateway_select on artifacts.staging_leases for select to nova3d_gateway using (true);
create policy gateway_insert on artifacts.staging_leases for insert to nova3d_gateway with check (true);
create policy gateway_update on artifacts.staging_leases for update to nova3d_gateway using (true) with check (true);
create policy gateway_select on artifacts.ticket_redemptions for select to nova3d_gateway using (true);
create policy gateway_insert on artifacts.ticket_redemptions for insert to nova3d_gateway with check (true);
create policy gateway_select on artifacts.transfer_handles for select to nova3d_gateway using (true);
create policy gateway_insert on artifacts.transfer_handles for insert to nova3d_gateway with check (true);

-- The private bucket --------------------------------------------------------------------------------------------------------------------

-- Private, and with no policy on storage.objects for it: nothing but the gateway's own S3 key (which bypasses row policies) reaches it. The
-- bucket's limit is the largest object the gateway takes (100 MiB).
insert into storage.buckets (id, name, public, file_size_limit)
  values ('private-files', 'private-files', false, 104857600)
  on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit;

-- Revoking a key -----------------------------------------------------------------------------------------------------------------------

create type api.key_revocation as (outcome text, leases integer, transfers integer);

-- Writes the revocation of a key and, in the SAME transaction, ends every transfer handle and every staging lease opened under it (only the
-- application's key opens either: a revoked key of another issuer ends nothing here). `transfers` counts the handles ended. A ticket under the key is refused from this moment
-- (artifacts.guard_redemption). Idempotent: a repeat records nothing new and ends whatever is still open.
--   revoked | exists
create function api.revoke_service_key(p_issuer text, p_kid text, p_reason text)
returns api.key_revocation
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_result api.key_revocation;
  v_inserted boolean;
begin
  if p_issuer is null or p_issuer not in ('application', 'gateway', 'cad-worker', 'engine-worker', 'backup-service', 'heartbeat')
     or p_kid is null or p_kid !~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$'
     or p_reason is null or p_reason !~ '^[a-z][a-z0-9_]{0,39}$' then
    raise exception 'invalid argument' using errcode = '22023';
  end if;

  -- Serial with a redemption under this key (artifacts.guard_redemption holds the shared lock until its transaction ends).
  perform pg_advisory_xact_lock(hashtextextended('nova3d:service-key:' || p_issuer || ':' || p_kid, 0));

  insert into artifacts.service_key_revocations (issuer, kid, reason) values (p_issuer, p_kid, p_reason)
    on conflict (issuer, kid) do nothing
    returning true into v_inserted;

  v_result.leases := 0;
  v_result.transfers := 0;
  if p_issuer = 'application' then
    update artifacts.transfer_handles h set ended_at = clock_timestamp() where h.kid = p_kid and h.ended_at is null;
    get diagnostics v_result.transfers = row_count;
    update artifacts.staging_leases l set state = 'released' where l.kid = p_kid and l.state in ('receiving', 'complete');
    get diagnostics v_result.leases = row_count;
  end if;

  v_result.outcome := case when v_inserted then 'revoked' else 'exists' end;
  return v_result;
end;
$$;

comment on function api.revoke_service_key(text, text, text) is
  'Revokes a service-signing key and, in the same transaction, ends every staging lease and transfer handle opened under it. Returns how many of each it ended. revoked | exists.';

-- Listing what the hourly cleanup removes -----------------------------------------------------------------------------------------------------

create type api.expired_staging as (leases json);

-- The leases whose staging is to be removed: expired (whatever their state, so an upload that stopped is found) or released, and not yet
-- deleted. At most p_limit (1 to 50), oldest first, as [{upload_id, account_id}]. It reads only; the gateway deletes, on a signed command, and
-- re-checks in one statement that the lease is still expired or released (a lease renewed meanwhile is kept).
create function api.list_expired_staging(p_limit integer default 50)
returns api.expired_staging
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_result api.expired_staging;
begin
  if p_limit is null or p_limit not between 1 and 50 then
    raise exception 'invalid argument' using errcode = '22023';
  end if;
  select coalesce(json_agg(json_build_object('upload_id', l.id, 'account_id', l.account_id) order by l.expires_at, l.id), '[]'::json)
    into v_result.leases
    from (
      select s.id, s.account_id, s.expires_at
        from artifacts.staging_leases s
       where s.state <> 'deleted' and (s.state = 'released' or s.expires_at <= clock_timestamp())
       order by s.expires_at, s.id
       limit p_limit
    ) l;
  return v_result;
end;
$$;

comment on function api.list_expired_staging(integer) is
  'The staging leases the hourly cleanup removes: expired or released, not yet deleted, at most 50, oldest first, as [{upload_id, account_id}]. Read-only.';

-- The preflight --------------------------------------------------------------------------------------------------------------------------

-- Everything api.preflight read before (20261014120000_scheduled_jobs.sql), plus what this story depends on: the six Artifacts tables (with the
-- columns the gateway and the functions use) and the two views, the three functions of this story, and the private bucket (it exists and is
-- not public). The service role can execute the two `api` functions (twenty-four `api` functions in all). It checks the catalog and executes none
-- of them, reads at most one row of each table and writes nothing.
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
      'api.list_expired_staging(integer)'
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
  'Reads identity.session_grants (including its CSRF columns), identity.accounts (including its status handle), identity.account_preferences, identity.step_up_nonces, identity.fresh_authentications (including source), identity.recovery_tokens, projects.projects, projects.project_commands, lifecycle.tombstones, lifecycle.ledger_outbox, lifecycle.ledger_relay, lifecycle.status_requests, lifecycle.job_receipts, the six artifacts tables and the artifacts.session_authority and artifacts.instance views, auth.sessions, auth.identities and auth.mfa_amr_claims (one row each at most), checks that the Story 1.5, 1.6, 1.7, 1.8, 1.9 and 1.12 functions exist and are executable by the service role, that the private-files bucket exists and is private, and that the owner may delete from auth.sessions and auth.users, and answers ok. Read-only.';

-- Access --------------------------------------------------------------------------------------------------------------------------------

-- Closed by default; only the service role is let in, by name. (create or replace keeps the grants api.preflight already had.)
grant execute on function api.revoke_service_key(text, text, text) to service_role;
grant execute on function api.list_expired_staging(integer) to service_role;

-- New functions and types: have the Data API reload its schema cache now.
notify pgrst, 'reload schema';
