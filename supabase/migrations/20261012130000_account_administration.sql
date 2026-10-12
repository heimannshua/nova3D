-- Story 1.5: disable and re-enable account access.
--
-- The Administrator's Accounts page (AD-02) lists the Accounts and turns one off or on. This migration adds the
-- database side, and with it the authority check that every future Job and file path must pass.
--
--   api.list_accounts        the Accounts, newest first: the verified Google address, the invitation that made the
--                            Account (its kind and, for a named code, its name), role, status and creation time. Never
--                            Workspace content, a project name or usage.
--   api.disable_account      ONE transaction, under a lock on the Account row: the status changes (the status change
--                            raises the authorization epoch in identity.guard_account and audits account.epoch_raised),
--                            every session grant of the Account is revoked (api.revoke_grants, audited per grant), its
--                            Auth sessions are ended, and account.disabled is audited. The Workspace is untouched.
--                            disabled | already_disabled | administrator | not_found
--   api.enable_account       the Account is active again under a NEWER epoch (the status change raises it) and
--                            account.enabled is audited. Revoked grants stay revoked and the ended Auth sessions stay
--                            ended: the person signs in anew. enabled | already_enabled | not_found
--   api.guard_operation      the authority check for the application's own steps (a Job's claim, an external call, a
--                            file chunk): allowed | disabled | stale_epoch | no_account. Read-only.
--   identity.assert_operation_authority
--                            the same check for SQL that publishes. It takes the Account row FOR SHARE, which
--                            api.disable_account's FOR UPDATE waits for, so a disable cannot commit between the check
--                            and the write that follows it in the same transaction: either the publication commits
--                            first and the disable then proceeds, or the disable commits first and the check raises.
--   api.record_account_refusal
--                            records a refused disable or enable (account.disable_refused, account.enable_refused,
--                            account.denied), in the pattern of api.record_invitation_refusal.
--   api.preflight            probes the six functions above and the privilege to end Auth sessions, so an
--                            environment that refuses either fails the build instead of half-disabling.
--
-- An operation registers under the epoch of the live authorization that started it (api.authorize_session carries
-- it). The Account's epoch is raised by the status change of a disable and again by a re-enable, so an operation
-- that registered before a disable stays denied after the Account is enabled again: the guard answers stale_epoch.
-- Cancellation signals are sent by the application only AFTER api.disable_account has committed, so a canceller that
-- asks the guard always finds it denying.
--
-- The actor of a change is `user:<Auth user ID>`, passed by the server from the verified session, never from input.
--
-- Same pattern as the earlier migrations: nothing here adds a table; the functions are in the `api` schema (the one
-- in `identity` is callable by no API role at all), run as the table owner with an empty search_path, are closed by
-- default (the default-privileges rules of 20261010120000_accounts.sql) and granted to service_role by name at the end.
--
-- Stable error code for SQL that publishes:
--   N3010  the operation's Account has no authority for it (the reason is the end of the message: no_account,
--          disabled or stale_epoch)

create type api.account_summary as (account_id uuid, email text, invitation_kind text, invitation_label text, role text, status text, created_at timestamptz);
-- sessions_ended: the Auth sessions of the Account that were ended. grants_revoked: the session grants that were ended.
create type api.account_disabling as (outcome text, sessions_ended integer, grants_revoked integer, epoch bigint);
create type api.account_enabling as (outcome text, epoch bigint);
create type api.operation_guard as (outcome text, epoch bigint);
create type api.account_refusal as (outcome text);

-- The Accounts ------------------------------------------------------------------------------------------------

-- Newest first, at most 200. The address is the one Google verified (identity.verified_google), null if Auth no
-- longer vouches for it. invitation_kind is null for an Account that no code made (the pre-authorized Administrator).
-- Nothing about the Workspace is read.
create function api.list_accounts()
returns setof api.account_summary
language sql
stable
security definer
set search_path = ''
as $$
  select a.id, g.verified_email, i.kind, i.label, a.role, a.status, a.created_at
    from identity.accounts a
    left join lateral identity.verified_google(a.user_id) g on true
    left join lateral (
      select v.kind, v.label from identity.invitations v where v.redeemed_account_id = a.id order by v.created_at limit 1
    ) i on true
   order by a.created_at desc, a.id
   limit 200
$$;

comment on function api.list_accounts() is
  'Account ID, verified Google address, the invitation that made it (kind and name), role, status and creation time. Never Workspace content.';

-- Disabling ---------------------------------------------------------------------------------------------------

-- One transaction under a lock on the Account row, so two windows disabling at once are one disable and one
-- already_disabled, and a concurrent api.issue_grant (which holds the row FOR SHARE) either lands before the
-- revocation reads the grants or is refused as disabled after it.
--   disabled          the Account is disabled, under a newer epoch; grants revoked; Auth sessions ended; audited
--   already_disabled  nothing changed
--   administrator     the Administrator's Account cannot be disabled (recovery is Story 1.6); nothing changed
--   not_found         no such Account
-- The grants are revoked BEFORE the status changes: api.revoke_grants counts as live the grants that are still valid
-- under the current epoch, and the status change raises it.
create function api.disable_account(p_actor text, p_account_id uuid)
returns api.account_disabling
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_result api.account_disabling;
  v_account identity.accounts;
  v_revocation api.grant_revocation;
  v_sessions integer;
begin
  if p_actor is null or p_actor !~ '^[a-z][a-z_]*(:[A-Za-z0-9_-]{1,64}){0,2}$' or p_account_id is null then
    raise exception 'invalid argument' using errcode = '22023';
  end if;

  select * into v_account from identity.accounts a where a.id = p_account_id for update;
  if not found then
    v_result.outcome := 'not_found';
    return v_result;
  end if;
  v_result.epoch := v_account.authorization_epoch;
  if v_account.role = 'administrator' then
    v_result.outcome := 'administrator';
    return v_result;
  end if;
  if v_account.status = 'disabled' then
    v_result.outcome := 'already_disabled';
    return v_result;
  end if;

  v_revocation := api.revoke_grants(p_actor, 'disabled', p_account_id => v_account.id);

  -- The status change raises the authorization epoch and audits account.epoch_raised (identity.guard_account).
  update identity.accounts a set status = 'disabled' where a.id = v_account.id
    returning a.authorization_epoch into v_result.epoch;

  -- Ends the Auth sessions of the person, so no refresh token can mint another access token. Done by the function's
  -- owner in this transaction; api.preflight probes that the owner may.
  delete from auth.sessions s where s.user_id = v_account.user_id;
  get diagnostics v_sessions = row_count;
  v_result.sessions_ended := v_sessions;

  perform identity.record_audit(p_actor, 'account.disabled', 'account:' || v_account.id::text);
  v_result.grants_revoked := v_revocation.revoked;
  v_result.outcome := 'disabled';
  return v_result;
end;
$$;

comment on function api.disable_account(text, uuid) is
  'Disables a member Account in one transaction: status and epoch, every session grant, its Auth sessions, and the account.disabled audit event. The Workspace is untouched. disabled | already_disabled | administrator | not_found.';

-- Enabling ----------------------------------------------------------------------------------------------------

-- The Account is active again under a newer epoch (the status change raises it). Nothing is restored: the grants
-- stay revoked and the Auth sessions stay ended, so the person signs in anew.
--   enabled          active again; audited
--   already_enabled  nothing changed
--   not_found        no such Account
create function api.enable_account(p_actor text, p_account_id uuid)
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
  if not found then
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
  'Enables a disabled Account under a newer epoch and audits account.enabled. Revoked grants and ended Auth sessions stay ended. enabled | already_enabled | not_found.';

-- The authority contract --------------------------------------------------------------------------------------

-- Whether an operation may take a step now. p_epoch is the authorization epoch the operation registered under: the
-- epoch of the live authorization (api.authorize_session) that started it. Read-only.
--   allowed      the Account exists, is active, and its epoch is the one the operation registered under
--   disabled     the Account is disabled
--   stale_epoch  the Account's epoch is not the one the operation registered under: it has been raised since (a
--                disable, a re-enable, a revocation by epoch), so the operation is older than the Account's current
--                authority and stays denied for good. (An operation cannot hold an epoch the Account has not reached;
--                one that does was not registered by this Account, and is denied the same way.)
--   no_account   no such Account
-- epoch is the Account's current epoch (null for no_account). The application treats an answer it cannot get as denied.
create function api.guard_operation(p_account_id uuid, p_epoch bigint)
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
  'The authority check for an application step of an operation registered under an epoch: allowed | disabled | stale_epoch | no_account. Read-only.';

-- The same check for SQL that publishes (a function that writes a Job's result, a file's final state): call it in the
-- transaction of the write, before the write. It takes the Account row FOR SHARE and keeps it until the transaction ends,
-- so api.disable_account (FOR UPDATE) cannot commit between the check and the write. Raises N3010 when the Account does
-- not exist, is disabled, or has an epoch other than the one the operation registered under; the reason is the end of the
-- message. Callable by no API role: only SQL that runs as the owner can reach it.
create function identity.assert_operation_authority(p_account_id uuid, p_epoch bigint) returns void
language plpgsql
set search_path = ''
as $$
declare
  v_account identity.accounts;
begin
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
  'For SQL that publishes: takes the Account FOR SHARE and raises N3010 unless it is active under the epoch the operation registered under.';

-- Refused attempts --------------------------------------------------------------------------------------------

-- The check that decides a refusal is made by the application, in the Server Action, before it calls
-- api.disable_account or api.enable_account; this only records what the application decided, and checks the one thing
-- it can: that the actor is a real Account, and that the refusal is the kind that Account can make (only an
-- Administrator is "refused for want of a marker", and only an Account that is not an Administrator is "denied").
-- What is recorded is who (user:<Auth user ID>), what (one of the three actions), which Account (account:<ID>, only if it
-- exists, so a caller that invents IDs cannot grow the append-only table with targets) and when. Never a reason, a marker
-- outcome, an address or any content. At most once an hour per actor, action and target, under an advisory lock.
--   recorded | repeated (the same refusal was already recorded in the last hour; nothing was written)
create function api.record_account_refusal(p_user_id uuid, p_action text, p_account_id uuid default null)
returns api.account_refusal
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_result api.account_refusal;
  v_role text;
  v_actor text;
  v_target text;
  v_seen boolean;
begin
  if p_user_id is null or p_action is null
     or p_action not in ('account.disable_refused', 'account.enable_refused', 'account.denied') then
    raise exception 'invalid argument' using errcode = '22023';
  end if;

  select a.role into v_role from identity.accounts a where a.user_id = p_user_id;
  if not found or (p_action = 'account.denied') = (v_role = 'administrator') then
    raise exception 'invalid argument' using errcode = '22023';
  end if;

  v_actor := 'user:' || p_user_id::text;
  if p_account_id is not null and exists (select 1 from identity.accounts a where a.id = p_account_id) then
    v_target := 'account:' || p_account_id::text;
  end if;

  perform pg_advisory_xact_lock(hashtextextended('account_refusal:' || v_actor || ':' || p_action || ':' || coalesce(v_target, ''), 0));
  v_seen := exists (
    select 1 from identity.audit_events e
     where e.actor = v_actor and e.action = p_action and e.target is not distinct from v_target
       and e.occurred_at > clock_timestamp() - interval '1 hour'
  );
  perform identity.record_audit_once(v_actor, p_action, v_target);
  v_result.outcome := case when v_seen then 'repeated' else 'recorded' end;
  return v_result;
end;
$$;

comment on function api.record_account_refusal(uuid, text, uuid) is
  'Records a refused Account change (account.disable_refused, account.enable_refused or account.denied): the actor and the Account as target when it exists. At most once an hour per actor, action and target. Never content. recorded | repeated.';

-- The preflight -----------------------------------------------------------------------------------------------

-- Everything api.preflight read before (20261011140000_account_preferences.sql), plus what this story depends on: the
-- six functions exist and the service role may execute the five it calls, and the function's owner may delete from
-- auth.sessions, which is how a disable ends the person's sessions. It checks the catalog and executes none of
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
  perform 1 from identity.fresh_authentications limit 1;
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
      'api.list_accounts()',
      'api.disable_account(text,uuid)',
      'api.enable_account(text,uuid)',
      'api.guard_operation(uuid,bigint)',
      'api.record_account_refusal(uuid,text,uuid)'
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
  'Reads identity.session_grants (including its CSRF columns), identity.accounts, identity.account_preferences, identity.step_up_nonces, identity.fresh_authentications, auth.sessions, auth.identities and auth.mfa_amr_claims (one row each at most), checks that the Story 1.5 functions exist and are executable by the service role and that the owner may delete from auth.sessions, and answers ok. Read-only.';

-- Access ------------------------------------------------------------------------------------------------------

-- Closed by default; only the service role is let in, by name. identity.assert_operation_authority is granted to
-- nobody: SQL that runs as the owner calls it. (create or replace keeps the grant api.preflight already had.)
grant execute on function api.list_accounts() to service_role;
grant execute on function api.disable_account(text, uuid) to service_role;
grant execute on function api.enable_account(text, uuid) to service_role;
grant execute on function api.guard_operation(uuid, bigint) to service_role;
grant execute on function api.record_account_refusal(uuid, text, uuid) to service_role;

-- New functions and types: have the Data API reload its schema cache now.
notify pgrst, 'reload schema';
