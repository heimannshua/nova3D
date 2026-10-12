-- Story 1.6: recover the sole Administrator securely.
--
-- If the Administrator's Google sign-in is lost or failing, nothing lets them back in short of database access.
-- A public Recover page mints a single-use token and the application emails nova3D's own link to the configured
-- Administrator address. A confirmation page POSTs it, the server mints a session through the Auth Admin API, and
-- ONE database transaction (api.redeem_recovery) ends every prior Administrator session, raises the authorization
-- epoch, grants the new session and gives it a fresh-authentication marker.
--
--   identity.recovery_tokens   one row per issuance: only the HMAC-SHA-256 of the token (under RECOVERY_HASH_KEY, computed
--                              by the application) is stored, with its issue, expiry, use and void times. It lives 15
--                              minutes on the database clock. There is one outstanding token at a time, and issuance is
--                              limited globally to 1 per 15 minutes and 5 per day, every issuance counting (a token that
--                              is voided after a mail failure still counts), read from these rows.
--
--   api.issue_recovery         issues a token for the one eligible Administrator: issued | limited | refused.
--   api.void_recovery          records that the mail could not be sent and, when the refusal was definitive, voids the
--                              token: voided | recorded | not_found.
--   api.check_recovery         read-only as to the token: says whether a token can be redeemed, and for whom (the Auth
--                              user to mint a session for), or why not: valid | unknown | used | expired | voided |
--                              administrator.
--   api.redeem_recovery        the transaction, under a lock on the Account: re-checks the token and marks it used, raises
--                              the epoch, revokes every grant of the Account, deletes every other Auth session of the
--                              person, issues the new session's grant, writes its marker and audits recovery.redeemed.
--                              Any refusal rolls ALL of it back (the audit event of the refusal stays).
--   api.preflight              probes the new table and the four functions, and carries every earlier probe forward.
--
-- Who is eligible: the one Account with role `administrator` that is active, whose verified Google address (the Auth
-- user's own email, read from Auth: identity.verified_google) equals the configured ADMINISTRATOR_EMAIL, and whose pinned
-- Google subject is still the Auth user's one Google identity. The application passes that address; no request supplies
-- it. None (or more than one), or a failed pinned-subject check, is refused and audited, and nothing is minted.
-- Recovery re-pins nothing: the new session works only if api.issue_grant accepts it, which is the pinned-subject check
-- again, inside the transaction.
--
-- Audit (identity.audit_events): the actor is `system:recovery` or `user:<Auth user ID>`, the target an opaque
-- `account:<id>` (none when no token or Account is known), never a token, a hash, an address or a reason. The events are
-- recovery.issued, recovery.limited, recovery.rejected.<unknown|used|expired|voided|administrator>, recovery.mail_failed
-- and recovery.redeemed. Refusals are recorded once an hour per actor, action and target, under an advisory lock.
--
-- The marker table (Story 1.4b) gets the only edit this story makes to it: a recovery has no step-up nonce, so the
-- marker's nonce becomes optional and the marker says where it came from (`source`).
--
-- Same pattern as the earlier migrations: the table is in the unexposed `identity` schema with row-level security on and
-- no policies, every privilege revoked from public, anon, authenticated and service_role; the functions in `api` run as
-- the table owner with an empty search_path, are closed by default (the default-privileges rules of
-- 20261010120000_accounts.sql) and granted to service_role by name at the end. The helpers in `identity` are callable by
-- no API role at all. Nothing here stores a token, a cookie, an address or a client address.
--
-- Stable error code:
--   N3030  the new session cannot be given a grant: caught inside api.redeem_recovery to undo the whole redemption

create type api.recovery_issuance as (outcome text, expires_at timestamptz);
create type api.recovery_check as (outcome text, user_id uuid, email text);
create type api.recovery_voiding as (outcome text);
create type api.recovery_redemption as (outcome text, sessions_ended integer, epoch bigint);

-- Recovery tokens ---------------------------------------------------------------------------------------------

create table identity.recovery_tokens (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references identity.accounts (id) on delete restrict,
  -- HMAC-SHA-256 (hex) of the token under RECOVERY_HASH_KEY. The token itself is never stored.
  token_hash text not null unique check (token_hash ~ '^[0-9a-f]{64}$'),
  issued_at timestamptz not null default clock_timestamp(),
  expires_at timestamptz not null,
  used_at timestamptz,
  voided_at timestamptz,
  check (expires_at > issued_at),
  check (used_at is null or voided_at is null)
);

-- The two limits read the rows by issue time.
create index recovery_tokens_issued on identity.recovery_tokens (issued_at);

comment on table identity.recovery_tokens is
  'Single-use Administrator recovery tokens: the keyed hash only, 15 minutes on the database clock, one outstanding, issuance limited globally to 1 per 15 minutes and 5 per day. Counted from these rows.';

-- What a token is can never change, and a used or voided one is final. The two timestamps of its life stay writable,
-- like a grant's: an operator or a test may need to age one.
create function identity.guard_recovery_token() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.id <> old.id or new.account_id <> old.account_id or new.token_hash <> old.token_hash then
    raise exception 'a recovery token cannot change what it is' using errcode = '55000';
  end if;
  if (old.used_at is not null or old.voided_at is not null)
     and (new.used_at is distinct from old.used_at or new.voided_at is distinct from old.voided_at) then
    raise exception 'a used or voided recovery token is final' using errcode = '55000';
  end if;
  return new;
end;
$$;

create trigger recovery_tokens_guard before update on identity.recovery_tokens
  for each row execute function identity.guard_recovery_token();

alter table identity.recovery_tokens enable row level security;
-- No policies: only the owner and roles that bypass RLS can read a row, and the revoke below leaves anon,
-- authenticated and service_role no path to the table at all.
revoke all on table identity.recovery_tokens from public, anon, authenticated, service_role;

-- The marker needs no nonce when a recovery wrote it ------------------------------------------------------------

alter table identity.fresh_authentications alter column nonce_id drop not null;
alter table identity.fresh_authentications
  add column source text not null default 'step_up' check (source in ('step_up', 'recovery'));
-- A step-up marker always names the nonce it came from, and a recovery marker never does.
alter table identity.fresh_authentications
  add constraint fresh_authentications_source_nonce check ((source = 'step_up') = (nonce_id is not null));

comment on column identity.fresh_authentications.source is
  'step_up: earned by a completed step-up (nonce_id names it). recovery: written by Administrator recovery (Story 1.6; no nonce).';

-- Same guard as before, with two changes: a marker's source can never change, and the nonce is compared with
-- `is distinct from`, so a marker that has none (a recovery's) cannot slip through a comparison with NULL.
create or replace function identity.guard_fresh_authentication() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.session_id <> old.session_id or new.action_class <> old.action_class or new.account_id <> old.account_id
     or new.nonce_id is distinct from old.nonce_id or new.step_up_started_at <> old.step_up_started_at
     or new.source <> old.source then
    raise exception 'a fresh-authentication marker cannot change what it is' using errcode = '55000';
  end if;
  if old.consumed_at is not null and new.consumed_at is distinct from old.consumed_at then
    raise exception 'a consumed fresh-authentication marker is final' using errcode = '55000';
  end if;
  return new;
end;
$$;

-- Internal helpers (identity schema; callable by no API role) -------------------------------------------------------

-- The eligible Administrator for a configured address: zero rows, one row, or (which every caller refuses) more. The
-- Account is an active Administrator's, and the Auth user's one verified Google identity (identity.verified_google: the
-- address is read from Auth, never from a caller) carries this address and the Account's pinned Google subject.
create function identity.recovery_administrator(p_email text)
returns table (account_id uuid, user_id uuid, email text)
language sql
stable
set search_path = ''
as $$
  select a.id, a.user_id, g.verified_email
    from identity.accounts a
    join lateral identity.verified_google(a.user_id) g on true
   where a.role = 'administrator'
     and a.status = 'active'
     and g.verified_email = lower(btrim(p_email))
     and g.google_subject = a.google_subject
$$;

-- Records a refusal at most once an hour per actor, action and target, under an advisory lock, so "at most once an hour"
-- holds under concurrency too (the pattern of api.record_account_refusal).
create function identity.record_recovery_refusal(p_actor text, p_action text, p_target text default null) returns void
language plpgsql
set search_path = ''
as $$
begin
  perform pg_advisory_xact_lock(hashtextextended('recovery_refusal:' || p_actor || ':' || p_action || ':' || coalesce(p_target, ''), 0));
  perform identity.record_audit_once(p_actor, p_action, p_target);
end;
$$;

-- Issuing -------------------------------------------------------------------------------------------------------

-- Issues a token for the one eligible Administrator. The token is made by the application; only its keyed hash comes
-- here. In one transaction, one issuance at a time (an advisory lock), so the limits below count under serialization:
--   * no eligible Administrator (none, more than one, an Account that is not active, an address that Auth does not
--     vouch for, or a pinned Google subject that no longer matches) is `refused` and audited
--     (recovery.rejected.administrator); nothing is issued;
--   * an issuance in the last 15 minutes, or 5 in the last 24 hours (every issuance counts, voided ones included), is
--     `limited` and audited once an hour (recovery.limited); nothing is issued;
--   * otherwise any outstanding token is voided, a new one that lives 15 minutes on the database clock is written, and
--     recovery.issued is audited.
--   issued | limited | refused
create function api.issue_recovery(p_token_hash text, p_administrator_email text)
returns api.recovery_issuance
language plpgsql
security definer
set search_path = ''
as $$
declare
  c_ttl constant interval := interval '15 minutes';
  c_spacing constant interval := interval '15 minutes';
  c_day constant interval := interval '24 hours';
  c_per_day constant integer := 5;
  v_now timestamptz;
  v_result api.recovery_issuance;
  v_account identity.accounts;
  v_eligible uuid;
begin
  if p_token_hash is null or p_token_hash !~ '^[0-9a-f]{64}$'
     or p_administrator_email is null or btrim(p_administrator_email) = '' or length(p_administrator_email) > 254 then
    raise exception 'invalid argument' using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('nova3d/recovery/issue', 0));

  if (select count(*) from identity.recovery_administrator(p_administrator_email)) <> 1 then
    perform identity.record_recovery_refusal('system:recovery', 'recovery.rejected.administrator', null);
    v_result.outcome := 'refused';
    return v_result;
  end if;
  select r.account_id into v_eligible from identity.recovery_administrator(p_administrator_email) r;
  -- The lock on the Account, which a redemption takes too; then the eligibility is read once more, because an Account
  -- that changed while this waited is no longer the one that was found.
  select * into v_account from identity.accounts a where a.id = v_eligible for update;
  if (select count(*) from identity.recovery_administrator(p_administrator_email) r where r.account_id = v_account.id) <> 1 then
    perform identity.record_recovery_refusal('system:recovery', 'recovery.rejected.administrator', null);
    v_result.outcome := 'refused';
    return v_result;
  end if;
  -- The limits and the expiry are judged at the moment this is allowed to act, not when the call began.
  v_now := clock_timestamp();

  if exists (select 1 from identity.recovery_tokens t where t.issued_at > v_now - c_spacing)
     or (select count(*) from identity.recovery_tokens t where t.issued_at > v_now - c_day) >= c_per_day then
    perform identity.record_recovery_refusal('system:recovery', 'recovery.limited', 'account:' || v_account.id::text);
    v_result.outcome := 'limited';
    return v_result;
  end if;

  -- One outstanding at a time. (With one issuance allowed per 15 minutes and a life of 15 minutes there is rarely one to
  -- void, but a limit that is changed later must not leave two.)
  update identity.recovery_tokens t set voided_at = v_now
   where t.account_id = v_account.id and t.used_at is null and t.voided_at is null and t.expires_at > v_now;

  insert into identity.recovery_tokens (account_id, token_hash, issued_at, expires_at)
    values (v_account.id, p_token_hash, v_now, v_now + c_ttl)
    returning expires_at into v_result.expires_at;
  perform identity.record_audit('system:recovery', 'recovery.issued', 'account:' || v_account.id::text);
  v_result.outcome := 'issued';
  return v_result;
end;
$$;

comment on function api.issue_recovery(text, text) is
  'Issues a recovery token (keyed hash only, 15 minutes) for the one eligible Administrator, limited globally to 1 per 15 minutes and 5 per day. issued | limited | refused. Audited.';

-- A failed send ---------------------------------------------------------------------------------------------------

-- The application could not send the mail. Audited (recovery.mail_failed, against the Account). A definitive refusal by
-- the mail provider (the message was not sent) also voids the token, so nothing usable remains; a failure whose outcome
-- is unknown (a timeout: the mail may have gone out) leaves the token as it was, because voiding it could lock the
-- Administrator out for 15 minutes after a mail that did arrive. Either way the issuance still counts toward the limits.
--   voided      the token was outstanding and is now void
--   recorded    the failure is audited; the token was left as it was (an unknown outcome, or it was no longer outstanding)
--   not_found   no such token
create function api.void_recovery(p_token_hash text, p_definitive boolean)
returns api.recovery_voiding
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_result api.recovery_voiding;
  v_token identity.recovery_tokens;
begin
  if p_token_hash is null or p_token_hash !~ '^[0-9a-f]{64}$' or p_definitive is null then
    raise exception 'invalid argument' using errcode = '22023';
  end if;

  select * into v_token from identity.recovery_tokens t where t.token_hash = p_token_hash for update;
  if not found then
    v_result.outcome := 'not_found';
    return v_result;
  end if;

  perform identity.record_audit('system:recovery', 'recovery.mail_failed', 'account:' || v_token.account_id::text);
  if p_definitive and v_token.used_at is null and v_token.voided_at is null then
    update identity.recovery_tokens t set voided_at = clock_timestamp() where t.id = v_token.id;
    v_result.outcome := 'voided';
  else
    v_result.outcome := 'recorded';
  end if;
  return v_result;
end;
$$;

comment on function api.void_recovery(text, boolean) is
  'Audits a failed recovery mail (recovery.mail_failed) and, for a definitive refusal, voids the outstanding token. voided | recorded | not_found.';

-- Checking ----------------------------------------------------------------------------------------------------------

-- Whether a token can be redeemed. It changes nothing about the token (the application mints a session only after this
-- says valid, and the redemption checks again under a lock); a refusal is audited, at most once an hour per action and
-- target, as recovery.rejected.<reason> against the token's Account (none for an unknown token).
--   valid          unused, unvoided, unexpired, and its Account is still the one eligible Administrator; user_id and email
--                  are the Auth user to mint a session for and its own address, read from Auth
--   unknown | used | voided | expired | administrator   not valid, and why (administrator: the Account is not, or no
--                  longer, the one eligible Administrator, including a pinned subject that no longer matches)
create function api.check_recovery(p_token_hash text, p_administrator_email text)
returns api.recovery_check
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_now timestamptz;
  v_result api.recovery_check;
  v_token identity.recovery_tokens;
  v_admin record;
  v_reason text;
begin
  if p_token_hash is null or p_token_hash !~ '^[0-9a-f]{64}$'
     or p_administrator_email is null or btrim(p_administrator_email) = '' or length(p_administrator_email) > 254 then
    raise exception 'invalid argument' using errcode = '22023';
  end if;

  select * into v_token from identity.recovery_tokens t where t.token_hash = p_token_hash;
  v_now := clock_timestamp();
  if not found then
    perform identity.record_recovery_refusal('system:recovery', 'recovery.rejected.unknown', null);
    v_result.outcome := 'unknown';
    return v_result;
  end if;

  v_reason := case
    when v_token.used_at is not null then 'used'
    when v_token.voided_at is not null then 'voided'
    when v_token.expires_at <= v_now then 'expired'
    else null
  end;
  if v_reason is null then
    select r.user_id, r.email into v_admin
      from identity.recovery_administrator(p_administrator_email) r where r.account_id = v_token.account_id;
    if not found or (select count(*) from identity.recovery_administrator(p_administrator_email)) <> 1 then
      v_reason := 'administrator';
    end if;
  end if;

  if v_reason is not null then
    perform identity.record_recovery_refusal('system:recovery', 'recovery.rejected.' || v_reason, 'account:' || v_token.account_id::text);
    v_result.outcome := v_reason;
    return v_result;
  end if;
  v_result.outcome := 'valid';
  v_result.user_id := v_admin.user_id;
  v_result.email := v_admin.email;
  return v_result;
end;
$$;

comment on function api.check_recovery(text, text) is
  'Whether a recovery token can be redeemed, and for which Auth user: valid | unknown | used | expired | voided | administrator. Changes nothing but the audit of a refusal.';

-- Redeeming -----------------------------------------------------------------------------------------------------------

-- The recovery itself. The application has checked the token (api.check_recovery) and minted a session through the Auth
-- Admin API that is inert until now: it holds no grant. The user is Auth's verified user and the session the one in the
-- verified access token (never a client's). In ONE transaction, under a lock on the Account (FOR UPDATE, which two
-- windows redeeming the same link queue on, so exactly one recovers):
--   1. the token is read again: used, voided, expired or unknown refuses, and so does an Account that is not (or is no
--      longer) the one eligible Administrator, or a user that is not that Account's;
--   2. the token is marked used;
--   3. the authorization epoch is raised (api.raise_authorization_epoch), so every grant issued before is stale;
--   4. every grant of the Account is revoked (api.revoke_grants, reason `recovery`, audited per grant);
--   5. every other Auth session of the person is deleted;
--   6. the new session is given its grant (api.issue_grant), AFTER the epoch is raised or it would be stale. Recovery
--      re-pins nothing: a session that cannot hold a grant (the pinned Google subject no longer matches the Auth user's
--      Google identity, the Account is disabled, Auth has no such session) undoes the whole redemption;
--   7. the marker is written: class administration, five minutes, this session only, source recovery;
--   8. recovery.redeemed is audited (actor user:<Auth user ID>, target account:<id>).
-- Any refusal rolls back ALL of it (steps 2 to 8 run in a sub-transaction), then audits recovery.rejected.<reason> once an
-- hour; the loser of a race is refused as `used` and its caller ends only its own session.
--   redeemed | unknown | used | expired | voided | administrator
-- sessions_ended is the number of OTHER Auth sessions that were deleted; epoch is the Account's new epoch.
create function api.redeem_recovery(p_token_hash text, p_administrator_email text, p_user_id uuid, p_session_id uuid)
returns api.recovery_redemption
language plpgsql
security definer
set search_path = ''
as $$
declare
  c_marker_ttl constant interval := interval '5 minutes';
  v_now timestamptz;
  v_result api.recovery_redemption;
  v_token identity.recovery_tokens;
  v_account identity.accounts;
  v_actor text;
  v_reason text;
  v_grant api.grant_receipt;
  v_sessions integer;
begin
  if p_token_hash is null or p_token_hash !~ '^[0-9a-f]{64}$'
     or p_administrator_email is null or btrim(p_administrator_email) = '' or length(p_administrator_email) > 254
     or p_user_id is null or p_session_id is null then
    raise exception 'invalid argument' using errcode = '22023';
  end if;
  v_actor := 'user:' || p_user_id::text;

  select * into v_token from identity.recovery_tokens t where t.token_hash = p_token_hash;
  if not found then
    perform identity.record_recovery_refusal(v_actor, 'recovery.rejected.unknown', null);
    v_result.outcome := 'unknown';
    return v_result;
  end if;

  -- The lock on the Account, and only then the token again: a redemption that waited for another one reads what it left.
  select * into v_account from identity.accounts a where a.id = v_token.account_id for update;
  select * into v_token from identity.recovery_tokens t where t.id = v_token.id for update;
  v_now := clock_timestamp();

  v_reason := case
    when v_token.used_at is not null then 'used'
    when v_token.voided_at is not null then 'voided'
    when v_token.expires_at <= v_now then 'expired'
    when v_account.user_id is distinct from p_user_id then 'administrator'
    when (select count(*) from identity.recovery_administrator(p_administrator_email)) <> 1 then 'administrator'
    when not exists (select 1 from identity.recovery_administrator(p_administrator_email) r where r.account_id = v_account.id) then 'administrator'
    else null
  end;

  if v_reason is null then
    begin
      update identity.recovery_tokens t set used_at = v_now where t.id = v_token.id;
      perform api.raise_authorization_epoch(v_account.id, v_actor);
      perform api.revoke_grants(p_actor => v_actor, p_reason => 'recovery', p_account_id => v_account.id);
      delete from auth.sessions s where s.user_id = v_account.user_id and s.id <> p_session_id;
      get diagnostics v_sessions = row_count;
      v_grant := api.issue_grant(p_user_id, p_session_id);
      if v_grant.outcome is distinct from 'issued' then
        raise exception 'the new session cannot be given a grant' using errcode = 'N3030';
      end if;
      insert into identity.fresh_authentications (session_id, action_class, account_id, nonce_id, step_up_started_at, issued_at, expires_at, source)
        values (p_session_id, 'administration', v_account.id, null, v_now, v_now, v_now + c_marker_ttl, 'recovery');
      perform identity.record_audit(v_actor, 'recovery.redeemed', 'account:' || v_account.id::text);
      v_result.outcome := 'redeemed';
      v_result.sessions_ended := v_sessions;
      v_result.epoch := v_grant.epoch;
    exception when sqlstate 'N3030' then
      -- Everything since `begin` is undone, the audit events of the failed grant included.
      v_reason := 'administrator';
    end;
  end if;

  if v_reason is not null then
    perform identity.record_recovery_refusal(v_actor, 'recovery.rejected.' || v_reason, 'account:' || v_account.id::text);
    v_result.outcome := v_reason;
    v_result.sessions_ended := null;
    v_result.epoch := null;
  end if;
  return v_result;
end;
$$;

comment on function api.redeem_recovery(text, text, uuid, uuid) is
  'Redeems a recovery token in one transaction under a lock on the Account: marks it used, raises the epoch, revokes every grant, deletes the other Auth sessions, issues the new session''s grant and its administration marker (source recovery), audits recovery.redeemed. Any refusal undoes all of it. redeemed | unknown | used | expired | voided | administrator.';

-- The preflight -----------------------------------------------------------------------------------------------------

-- Everything api.preflight read before (20261012130000_account_administration.sql), plus what this story depends on: the
-- recovery table, the marker's new column, and the four functions exist and the service role may execute them. It checks
-- the catalog and executes none of them, reads at most one row of each table and writes nothing.
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
      'api.list_accounts()',
      'api.disable_account(text,uuid)',
      'api.enable_account(text,uuid)',
      'api.guard_operation(uuid,bigint)',
      'api.record_account_refusal(uuid,text,uuid)',
      'api.issue_recovery(text,text)',
      'api.void_recovery(text,boolean)',
      'api.check_recovery(text,text)',
      'api.redeem_recovery(text,text,uuid,uuid)'
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
  'Reads identity.session_grants (including its CSRF columns), identity.accounts, identity.account_preferences, identity.step_up_nonces, identity.fresh_authentications (including source), identity.recovery_tokens, auth.sessions, auth.identities and auth.mfa_amr_claims (one row each at most), checks that the Story 1.5 and 1.6 functions exist and are executable by the service role and that the owner may delete from auth.sessions, and answers ok. Read-only.';

-- Access ------------------------------------------------------------------------------------------------------------

-- Closed by default; only the service role is let in, by name. The helpers in `identity` are granted to nobody: SQL that
-- runs as the owner calls them. (create or replace keeps the grant api.preflight already had.)
grant execute on function api.issue_recovery(text, text) to service_role;
grant execute on function api.void_recovery(text, boolean) to service_role;
grant execute on function api.check_recovery(text, text) to service_role;
grant execute on function api.redeem_recovery(text, text, uuid, uuid) to service_role;

-- New functions and types: have the Data API reload its schema cache now.
notify pgrst, 'reload schema';
