-- Story 1.3 (Part A: database): the `api` schema, the only callable surface.
--
-- Every function here runs as the table owner (security definer, empty search_path) and is
-- executable by the service role alone, which is how the server routes and the audited seed
-- command call it. anon, authenticated and public hold nothing: not the schema, not a function.
-- The one other grantee is supabase_auth_admin, the Auth service's own role, which Supabase
-- requires to run the Before User Created hook.
--
-- The database never sees a raw invitation code or a client address. Callers pass HMAC-SHA256
-- hashes (lib/accounts.ts).
--
-- Rows that leave a function are generic by design: a bad, used, revoked or never-issued code is
-- one outcome, `refused`, and a rate-limited attempt is `limited`.
--
-- Stable error codes (SQLSTATE) the seed command can receive:
--   22023  invalid argument                                  N3001  the address already owns an Account
--   N3002  the address is pre-authorized with another role

create schema if not exists api;
comment on schema api is 'Story 1.3. The only callable surface of Identity and Projects. EXECUTE belongs to service_role alone.';

revoke all on schema api from public, anon, authenticated;
alter default privileges for role postgres in schema api revoke execute on functions from public, anon, authenticated, service_role;

create type api.registration_receipt as (
  command_id uuid,
  outcome text,
  account_id uuid,
  workspace_id uuid,
  role text,
  replayed boolean
);
create type api.activation_receipt as (outcome text, account_id uuid, workspace_id uuid, role text);
create type api.account_state as (status text, account_id uuid, workspace_id uuid, role text);
create type api.invitation_receipt as (outcome text, invitation_id uuid, kind text, replaced_invitation_id uuid);
create type api.revocation_receipt as (invitation_id uuid, outcome text);
create type api.preauthorization_receipt as (preauthorization_id uuid, role text, created boolean, consumed boolean, other_administrators integer);
create type api.withdrawal_receipt as (outcome text);
create type api.invitation_summary as (invitation_id uuid, kind text, label text, state text, created_at timestamptz);

-- Internal helpers (identity schema; callable by no API role) ------------------------------------

-- The verified Google identity of an Auth user, read from auth.users and auth.identities and never
-- from caller input. One row when the user has exactly one Google identity, the email is verified on
-- both the user and the identity, the identity carries the same address as the user (the address a
-- pre-authorization is matched on is the one Google verified), and the user is not anonymous,
-- deleted or banned.
create function identity.verified_google(p_user_id uuid)
returns table (verified_email text, google_subject text)
language sql
stable
set search_path = ''
as $$
  select lower(btrim(u.email)), max(i.provider_id)
    from auth.users u
    join auth.identities i on i.user_id = u.id and i.provider = 'google'
   where u.id = p_user_id
     and u.deleted_at is null
     and (u.banned_until is null or u.banned_until <= clock_timestamp())
     and not u.is_anonymous
     and u.email is not null
     and btrim(u.email) <> ''
     and u.email_confirmed_at is not null
   group by u.id, u.email
  having count(*) = 1
     and bool_and((i.identity_data ->> 'email_verified') = 'true')
     and bool_and(lower(btrim(i.identity_data ->> 'email')) = lower(btrim(u.email)))
     and max(i.provider_id) <> ''
$$;

create function identity.count_registration_failure(p_origin_hash text, p_origin_window bigint, p_global_window bigint)
returns void
language sql
set search_path = ''
as $$
  update identity.rate_limit_counters c
     set failures = c.failures + 1
   where (c.scope = 'origin' and c.key_hash = p_origin_hash and c.window_id = p_origin_window)
      or (c.scope = 'global' and c.key_hash = 'global' and c.window_id = p_global_window)
$$;

-- Registration ----------------------------------------------------------------------------------

-- Redeems an invitation code for the signed-in Auth user and activates its Account and Workspace.
--
-- One transaction, in this order, so concurrent callers queue instead of racing:
--   1. lock the auth.users row FOR UPDATE and persist the attempt time (a purge waits for it);
--   2. answer a repeated command, or an Auth user that already has an Account, with the Account it
--      has: that guesses nothing, so it is not limited (a retry from an origin at its limit still
--      gets its receipt). A command ID reused with another code is not answered here;
--   3. lock and read the origin and global failure counters, and refuse when either is spent;
--   4. refuse the reused command ID with another code, counted like any wrong guess;
--   5. claim the code, create the Account and Workspace, record the receipt and the audit event
--      in one sub-transaction: an expected failure (a constraint, a guard) undoes all of it and
--      leaves the code unused. Anything else (a deadlock, a lock timeout, a full disk) is not a
--      bad code: it propagates, the whole transaction rolls back and the caller fails closed.
-- Every refusal is counted. Limits: 5 failures per origin per 15 minutes, 100 per hour in all.
-- An Account that is disabled is never reported as registered: the outcome is `disabled`.
create function api.register_with_code(p_user_id uuid, p_command_id uuid, p_code_hash text, p_origin_hash text)
returns api.registration_receipt
language plpgsql
security definer
set search_path = ''
as $$
declare
  c_origin_limit constant integer := 5;
  c_global_limit constant integer := 100;
  v_epoch bigint := floor(extract(epoch from clock_timestamp()))::bigint;
  v_origin_window bigint := v_epoch / 900;
  v_global_window bigint := v_epoch / 3600;
  v_origin_failures integer;
  v_global_failures integer;
  v_receipt api.registration_receipt;
  v_command identity.registration_commands;
  v_account identity.accounts;
  v_known boolean := false;
  v_reused boolean := false;
  v_subject text;
  v_invitation_id uuid;
  v_account_id uuid;
  v_constraint text;
  v_ok boolean := false;
begin
  if p_user_id is null or p_command_id is null
     or p_code_hash is null or p_code_hash !~ '^[0-9a-f]{64}$'
     or p_origin_hash is null or p_origin_hash !~ '^[0-9a-f]{64}$' then
    raise exception 'invalid argument' using errcode = '22023';
  end if;

  v_receipt.command_id := p_command_id;
  v_receipt.replayed := false;

  -- 1. The identity lock and the persisted attempt time.
  perform 1 from auth.users u where u.id = p_user_id for update;
  if found then
    insert into identity.registration_attempts (user_id, last_attempt_at)
      values (p_user_id, clock_timestamp())
      on conflict (user_id) do update set last_attempt_at = excluded.last_attempt_at;
  end if;

  -- 2. What this user already has. The same command and code, or no command at all but an Account,
  --    is answered with the Account; the command ID of someone else's registration, or this user's
  --    own with another code, is a changed payload and falls through to the limiter.
  select * into v_command from identity.registration_commands rc where rc.command_id = p_command_id;
  if found then
    select * into v_account from identity.accounts a where a.id = v_command.account_id;
    if v_account.user_id = p_user_id and v_command.code_hash = p_code_hash then
      v_known := true;
    else
      v_reused := true;
    end if;
  else
    select * into v_account from identity.accounts a where a.user_id = p_user_id;
    v_known := found;
  end if;
  if v_known then
    v_receipt.outcome := case when v_account.status = 'active' then 'registered' else 'disabled' end;
    v_receipt.account_id := v_account.id;
    v_receipt.role := v_account.role;
    v_receipt.replayed := true;
    select w.id into v_receipt.workspace_id from projects.workspaces w where w.account_id = v_account.id;
    return v_receipt;
  end if;

  -- 3. The limiter. The no-op update takes each counter row's lock and reads it, so parallel
  --    attempts from one origin queue here and each sees the failures of those before it. Rows
  --    are locked in a fixed order (origin, then global).
  insert into identity.rate_limit_counters as c (scope, key_hash, window_id, failures, expires_at)
    values ('origin', p_origin_hash, v_origin_window, 0, to_timestamp((v_origin_window + 1) * 900 + 3600))
    on conflict (scope, key_hash, window_id) do update set expires_at = excluded.expires_at
    returning c.failures into v_origin_failures;
  insert into identity.rate_limit_counters as c (scope, key_hash, window_id, failures, expires_at)
    values ('global', 'global', v_global_window, 0, to_timestamp((v_global_window + 1) * 3600 + 3600))
    on conflict (scope, key_hash, window_id) do update set expires_at = excluded.expires_at
    returning c.failures into v_global_failures;
  -- Expired windows are dropped a few at a time, never waiting on a locked row.
  delete from identity.rate_limit_counters d
   where d.ctid in (
     select s.ctid from identity.rate_limit_counters s
      where s.expires_at < clock_timestamp()
      order by s.expires_at
      limit 50
      for update skip locked
   );

  if v_origin_failures >= c_origin_limit or v_global_failures >= c_global_limit then
    v_receipt.outcome := 'limited';
    return v_receipt;
  end if;

  -- 4. A command ID reused with another code (or by another user) is refused and counted.
  if v_reused then
    perform identity.count_registration_failure(p_origin_hash, v_origin_window, v_global_window);
    v_receipt.outcome := 'refused';
    return v_receipt;
  end if;

  -- Only a verified Google identity can register.
  select g.google_subject into v_subject from identity.verified_google(p_user_id) g;
  if v_subject is null then
    perform identity.count_registration_failure(p_origin_hash, v_origin_window, v_global_window);
    v_receipt.outcome := 'refused';
    return v_receipt;
  end if;

  -- 5. Claim the code and create everything, or nothing.
  begin
    select i.id into v_invitation_id
      from identity.invitations i
     where i.code_hash = p_code_hash and i.status = 'unused'
       for update;
    if found then
      v_account_id := identity.activate_account(p_user_id, v_subject, 'member', 'invitation');
      update identity.invitations i
         set status = 'redeemed', redeemed_at = clock_timestamp(), redeemed_account_id = v_account_id
       where i.id = v_invitation_id;
      insert into identity.registration_commands (command_id, account_id, code_hash)
        values (p_command_id, v_account_id, p_code_hash);
      perform identity.record_audit('account:' || v_account_id::text, 'account.activated', 'invitation:' || v_invitation_id::text);
      v_ok := true;
    end if;
  exception
    -- Specific conditions only. (A name that ends in 000, such as object_not_in_prerequisite_state, would
    -- match its whole class, lock_not_available included.)
    when unique_violation or foreign_key_violation or check_violation or not_null_violation or raise_exception then
      get stacked diagnostics v_constraint = constraint_name;
      raise warning 'api.register_with_code rolled back (sqlstate %, constraint %)', sqlstate, coalesce(v_constraint, '-');
      v_ok := false;
  end;

  if not v_ok then
    perform identity.count_registration_failure(p_origin_hash, v_origin_window, v_global_window);
    v_receipt.outcome := 'refused';
    return v_receipt;
  end if;

  v_receipt.outcome := 'registered';
  v_receipt.account_id := v_account_id;
  v_receipt.role := 'member';
  select w.id into v_receipt.workspace_id from projects.workspaces w where w.account_id = v_account_id;
  return v_receipt;
end;
$$;

comment on function api.register_with_code(uuid, uuid, text, text) is
  'Redeems an invitation code (by hash) for an Auth user: Account and Workspace in one transaction, idempotent per command UUID, limited per origin and globally.';

-- Consumes the pre-authorization of the signed-in user's address, if any: at the address's first
-- verified Google sign-in it creates the Account, pins the Google subject and provisions the
-- Workspace exactly as a code redemption does. Email, verification and subject come from
-- auth.users and auth.identities, never from the caller.
--   registered: the Account was just activated    active:   the user already has an Account
--   disabled:   the user's Account is disabled    none:     nothing to consume
--   refused:    the address was used by another subject, or the subject belongs to another Account
-- A refusal is audited at most once an hour per user and pre-authorization.
create function api.consume_preauthorization(p_user_id uuid)
returns api.activation_receipt
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_receipt api.activation_receipt;
  v_account identity.accounts;
  v_google record;
  v_preauthorization identity.preauthorizations;
  v_account_id uuid;
begin
  if p_user_id is null then
    raise exception 'invalid argument' using errcode = '22023';
  end if;

  perform 1 from auth.users u where u.id = p_user_id for update;
  if not found then
    v_receipt.outcome := 'none';
    return v_receipt;
  end if;
  insert into identity.registration_attempts (user_id, last_attempt_at)
    values (p_user_id, clock_timestamp())
    on conflict (user_id) do update set last_attempt_at = excluded.last_attempt_at;

  select * into v_account from identity.accounts a where a.user_id = p_user_id;
  if found then
    v_receipt.outcome := case when v_account.status = 'active' then 'active' else 'disabled' end;
    v_receipt.account_id := v_account.id;
    v_receipt.role := v_account.role;
    select w.id into v_receipt.workspace_id from projects.workspaces w where w.account_id = v_account.id;
    return v_receipt;
  end if;

  select * into v_google from identity.verified_google(p_user_id) g;
  if not found then
    v_receipt.outcome := 'none';
    return v_receipt;
  end if;

  select * into v_preauthorization
    from identity.preauthorizations p
   where p.email = v_google.verified_email
     for update;
  if not found then
    v_receipt.outcome := 'none';
    return v_receipt;
  end if;

  if v_preauthorization.consumed_at is not null then
    -- The address was already activated. Another Auth user presenting it is refused: with another
    -- Google subject that is a mismatch, and either way it is audited.
    perform identity.record_audit_once(
      'user:' || p_user_id::text,
      case when v_preauthorization.google_subject <> v_google.google_subject
           then 'registration.subject_mismatch' else 'registration.preauthorization_used' end,
      'preauthorization:' || v_preauthorization.id::text
    );
    v_receipt.outcome := 'refused';
    return v_receipt;
  end if;

  begin
    v_account_id := identity.activate_account(p_user_id, v_google.google_subject, v_preauthorization.role, 'preauthorization');
  exception when unique_violation then
    -- This Google subject is already pinned to another Account.
    v_account_id := null;
  end;
  if v_account_id is null then
    perform identity.record_audit_once('user:' || p_user_id::text, 'registration.subject_in_use', 'preauthorization:' || v_preauthorization.id::text);
    v_receipt.outcome := 'refused';
    return v_receipt;
  end if;

  update identity.preauthorizations p
     set consumed_at = clock_timestamp(), account_id = v_account_id, google_subject = v_google.google_subject
   where p.id = v_preauthorization.id;
  perform identity.record_audit('account:' || v_account_id::text, 'account.activated', 'preauthorization:' || v_preauthorization.id::text);

  v_receipt.outcome := 'registered';
  v_receipt.account_id := v_account_id;
  v_receipt.role := v_preauthorization.role;
  select w.id into v_receipt.workspace_id from projects.workspaces w where w.account_id = v_account_id;
  return v_receipt;
end;
$$;

comment on function api.consume_preauthorization(uuid) is
  'Activates the Account of a pre-authorized address at its first verified Google sign-in and pins the Google subject.';

-- Seeding and invitations -------------------------------------------------------------------------

-- Records a pre-authorization (address and role). Idempotent: seeding an address again changes
-- nothing; seeding it with another role is refused (N3002). An address that already owns an Account
-- is refused (N3001): a pre-authorization for it could never be consumed. Audited when it creates a
-- row. `other_administrators` counts the administrator pre-authorizations of other addresses, so the
-- seed command can warn that a second Administrator is being seeded.
create function api.seed_preauthorization(p_email text, p_role text, p_actor text)
returns api.preauthorization_receipt
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_email text := lower(btrim(p_email));
  v_receipt api.preauthorization_receipt;
  v_existing identity.preauthorizations;
begin
  if v_email is null or length(v_email) > 254 or v_email !~ '^[^\s@,;]+@[^\s@,;]+\.[^\s@,;]+$'
     or p_role is null or p_role not in ('administrator', 'member')
     or p_actor is null or p_actor !~ '^[a-z][a-z_]*(:[A-Za-z0-9_-]{1,64}){0,2}$' then
    raise exception 'invalid argument' using errcode = '22023';
  end if;

  select * into v_existing from identity.preauthorizations p where p.email = v_email;
  if not found then
    if exists (
      select 1 from auth.users u join identity.accounts a on a.user_id = u.id
       where lower(btrim(u.email)) = v_email
    ) then
      raise exception 'this address already has an Account' using errcode = 'N3001';
    end if;
    insert into identity.preauthorizations (email, role, created_by)
      values (v_email, p_role, p_actor)
      on conflict (email) do nothing
      returning id into v_receipt.preauthorization_id;
    if v_receipt.preauthorization_id is not null then
      perform identity.record_audit(p_actor, 'preauthorization.created', 'preauthorization:' || v_receipt.preauthorization_id::text);
      v_receipt.created := true;
      v_receipt.consumed := false;
    else
      select * into v_existing from identity.preauthorizations p where p.email = v_email;
    end if;
  end if;

  if v_receipt.preauthorization_id is null then
    if v_existing.role <> p_role then
      raise exception 'this address is already pre-authorized with another role' using errcode = 'N3002';
    end if;
    v_receipt.preauthorization_id := v_existing.id;
    v_receipt.created := false;
    v_receipt.consumed := v_existing.consumed_at is not null;
  end if;

  v_receipt.role := p_role;
  v_receipt.other_administrators := case when p_role = 'administrator'
    then (select count(*)::integer from identity.preauthorizations p where p.role = 'administrator' and p.email <> v_email)
    else 0 end;
  return v_receipt;
end;
$$;

comment on function api.seed_preauthorization(text, text, text) is
  'Records a pre-authorization (address and role) for the audited seed command. Idempotent. N3001: the address already owns an Account. N3002: another role.';

-- Withdraws a pre-authorization that has not been consumed. A consumed one is an Account's record
-- and is left as it is. Audited.   withdrawn | consumed | not_found
create function api.withdraw_preauthorization(p_email text, p_actor text)
returns api.withdrawal_receipt
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_email text := lower(btrim(p_email));
  v_receipt api.withdrawal_receipt;
  v_preauthorization identity.preauthorizations;
begin
  if v_email is null or length(v_email) > 254 or v_email !~ '^[^\s@,;]+@[^\s@,;]+\.[^\s@,;]+$'
     or p_actor is null or p_actor !~ '^[a-z][a-z_]*(:[A-Za-z0-9_-]{1,64}){0,2}$' then
    raise exception 'invalid argument' using errcode = '22023';
  end if;

  select * into v_preauthorization from identity.preauthorizations p where p.email = v_email for update;
  if not found then
    v_receipt.outcome := 'not_found';
  elsif v_preauthorization.consumed_at is not null then
    v_receipt.outcome := 'consumed';
  else
    delete from identity.preauthorizations p where p.id = v_preauthorization.id;
    perform identity.record_audit(p_actor, 'preauthorization.withdrawn', 'preauthorization:' || v_preauthorization.id::text);
    v_receipt.outcome := 'withdrawn';
  end if;
  return v_receipt;
end;
$$;

comment on function api.withdraw_preauthorization(text, text) is 'Deletes an unconsumed pre-authorization. Audited.';

-- Stores the hash of a freshly generated code. A general code is unique while unused: issuing
-- another is `exists` unless p_replace, which revokes the current one in the same transaction.
-- Concurrent general issues queue on an advisory lock, so their outcomes are predictable: one is
-- `issued` and the other `exists`. A code hash that already exists is `exists` too.
--   issued | exists
create function api.issue_invitation(p_code_hash text, p_kind text, p_label text, p_actor text, p_replace boolean default false)
returns api.invitation_receipt
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_label text := nullif(btrim(p_label), '');
  v_receipt api.invitation_receipt;
  v_current identity.invitations;
begin
  if p_code_hash is null or p_code_hash !~ '^[0-9a-f]{64}$'
     or p_kind is null or p_kind not in ('named', 'general')
     or (p_kind = 'named' and (v_label is null or length(v_label) > 80))
     or (p_kind = 'general' and v_label is not null)
     or p_actor is null or p_actor !~ '^[a-z][a-z_]*(:[A-Za-z0-9_-]{1,64}){0,2}$' then
    raise exception 'invalid argument' using errcode = '22023';
  end if;

  v_receipt.kind := p_kind;
  if p_kind = 'general' then
    perform pg_advisory_xact_lock(hashtextextended('invitation:general', 0));
  end if;

  begin
    if p_kind = 'general' then
      select * into v_current from identity.invitations i where i.kind = 'general' and i.status = 'unused' for update;
      if found then
        if not coalesce(p_replace, false) then
          v_receipt.outcome := 'exists';
          v_receipt.invitation_id := v_current.id;
          return v_receipt;
        end if;
        update identity.invitations i
           set status = 'revoked', revoked_at = clock_timestamp(), revoked_by = p_actor
         where i.id = v_current.id;
        perform identity.record_audit(p_actor, 'invitation.revoked', 'invitation:' || v_current.id::text);
        v_receipt.replaced_invitation_id := v_current.id;
      end if;
    end if;

    insert into identity.invitations (code_hash, kind, label, issued_by)
      values (p_code_hash, p_kind, v_label, p_actor)
      returning id into v_receipt.invitation_id;
    perform identity.record_audit(p_actor, 'invitation.issued', 'invitation:' || v_receipt.invitation_id::text);
  exception when unique_violation then
    v_receipt.outcome := 'exists';
    v_receipt.invitation_id := null;
    v_receipt.replaced_invitation_id := null;
    return v_receipt;
  end;

  v_receipt.outcome := 'issued';
  return v_receipt;
end;
$$;

comment on function api.issue_invitation(text, text, text, text, boolean) is
  'Stores the hash of a named or general invitation code. The code itself never reaches the database. Outcome issued or exists.';

-- Revokes an unused code, by invitation ID or by code hash. Existing Accounts are untouched.
--   revoked | already_revoked | redeemed (final, left as it is) | not_found
create function api.revoke_invitation(p_actor text, p_invitation_id uuid default null, p_code_hash text default null)
returns api.revocation_receipt
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_receipt api.revocation_receipt;
  v_invitation identity.invitations;
begin
  if p_actor is null or p_actor !~ '^[a-z][a-z_]*(:[A-Za-z0-9_-]{1,64}){0,2}$'
     or (p_invitation_id is null) = (p_code_hash is null)
     or (p_code_hash is not null and p_code_hash !~ '^[0-9a-f]{64}$') then
    raise exception 'invalid argument' using errcode = '22023';
  end if;

  select * into v_invitation
    from identity.invitations i
   where (p_invitation_id is not null and i.id = p_invitation_id)
      or (p_code_hash is not null and i.code_hash = p_code_hash)
     for update;
  if not found then
    v_receipt.outcome := 'not_found';
    return v_receipt;
  end if;

  v_receipt.invitation_id := v_invitation.id;
  if v_invitation.status = 'unused' then
    update identity.invitations i
       set status = 'revoked', revoked_at = clock_timestamp(), revoked_by = p_actor
     where i.id = v_invitation.id;
    perform identity.record_audit(p_actor, 'invitation.revoked', 'invitation:' || v_invitation.id::text);
    v_receipt.outcome := 'revoked';
  elsif v_invitation.status = 'revoked' then
    v_receipt.outcome := 'already_revoked';
  else
    v_receipt.outcome := 'redeemed';
  end if;
  return v_receipt;
end;
$$;

comment on function api.revoke_invitation(text, uuid, text) is
  'Revokes an unused invitation by ID or code hash. Never touches an existing Account.';

-- The invitations, newest first: ID, kind, label, state (unused, redeemed, revoked) and creation
-- time. Never a hash or a code. The operator reads it to revoke by ID.
create function api.list_invitations()
returns setof api.invitation_summary
language sql
stable
security definer
set search_path = ''
as $$
  select i.id, i.kind, i.label, i.status, i.created_at
    from identity.invitations i
   order by i.created_at desc, i.id
   limit 200
$$;

comment on function api.list_invitations() is 'Invitation ID, kind, label, state and creation time. Never a hash or a code.';

-- Status -----------------------------------------------------------------------------------------

-- The Account of an Auth user: status is none, active or disabled. Part B gates private routes on it.
create function api.account_status(p_user_id uuid)
returns api.account_state
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_state api.account_state;
  v_account identity.accounts;
begin
  select * into v_account from identity.accounts a where a.user_id = p_user_id;
  if not found then
    v_state.status := 'none';
    return v_state;
  end if;
  v_state.status := v_account.status;
  v_state.account_id := v_account.id;
  v_state.role := v_account.role;
  select w.id into v_state.workspace_id from projects.workspaces w where w.account_id = v_account.id;
  return v_state;
end;
$$;

comment on function api.account_status(uuid) is 'none, active or disabled, with the Account and Workspace IDs when there is one.';

-- Before User Created hook ------------------------------------------------------------------------

-- Supabase Auth calls this before it creates any Auth user through sign-up, an OAuth callback or an
-- invitation (declared in supabase/config.toml). It accepts only a Google identity with a verified
-- email and rejects everything else: email, phone, anonymous, any other provider, a missing or
-- unverified email, and any payload it cannot read. It reads the provider from user.app_metadata and
-- the verification from the provider's own claim in user.user_metadata. It never raises: a failure is
-- a rejection. (The Auth admin create-user endpoint does not call the hook; it needs the service key.)
create function api.before_user_created(event jsonb)
returns jsonb
language plpgsql
stable
set search_path = ''
as $$
declare
  v_user jsonb := event -> 'user';
  v_providers jsonb;
  v_verified jsonb;
  c_reject constant jsonb := jsonb_build_object(
    'error', jsonb_build_object('http_code', 403, 'message', 'Sign-in is not available for this account.')
  );
begin
  if jsonb_typeof(v_user) is distinct from 'object' then
    return c_reject;
  end if;
  if (v_user #> '{app_metadata,provider}') is distinct from '"google"'::jsonb then
    return c_reject;
  end if;
  v_providers := v_user #> '{app_metadata,providers}';
  if v_providers is not null and v_providers is distinct from '["google"]'::jsonb then
    return c_reject;
  end if;
  if (v_user -> 'is_anonymous') = 'true'::jsonb then
    return c_reject;
  end if;
  if coalesce(v_user ->> 'phone', '') <> '' then
    return c_reject;
  end if;
  if jsonb_typeof(v_user -> 'email') is distinct from 'string' or btrim(v_user ->> 'email') = '' then
    return c_reject;
  end if;
  v_verified := v_user #> '{user_metadata,email_verified}';
  if v_verified is null or v_verified not in ('true'::jsonb, '"true"'::jsonb) then
    return c_reject;
  end if;
  return '{}'::jsonb;
exception when others then
  return c_reject;
end;
$$;

comment on function api.before_user_created(jsonb) is
  'Before User Created hook: only a Google identity with a verified email may create an Auth user.';

-- Access -----------------------------------------------------------------------------------------

revoke all on all functions in schema api from public, anon, authenticated, service_role;
revoke all on all functions in schema identity from public, anon, authenticated, service_role;
revoke all on all functions in schema projects from public, anon, authenticated, service_role;

grant usage on schema api to service_role, supabase_auth_admin;

grant execute on function api.register_with_code(uuid, uuid, text, text) to service_role;
grant execute on function api.consume_preauthorization(uuid) to service_role;
grant execute on function api.seed_preauthorization(text, text, text) to service_role;
grant execute on function api.withdraw_preauthorization(text, text) to service_role;
grant execute on function api.issue_invitation(text, text, text, text, boolean) to service_role;
grant execute on function api.revoke_invitation(text, uuid, text) to service_role;
grant execute on function api.list_invitations() to service_role;
grant execute on function api.account_status(uuid) to service_role;

-- The Auth service calls the hook as supabase_auth_admin, which therefore needs the schema and the
-- function. Nothing else can reach it.
grant execute on function api.before_user_created(jsonb) to supabase_auth_admin;
