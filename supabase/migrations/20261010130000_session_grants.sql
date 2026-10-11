-- Story 1.4a: session grants and live authorization.
--
-- Identity owns the session grant: one row per Auth session, issued when a signed-in session becomes an
-- active Account's, checked on every private request by api.authorize_session, and ended by the one
-- revocation primitive, api.revoke_grants (by session, by Account, or below an epoch). Raising an
-- Account's authorization epoch (api.raise_authorization_epoch) ends every older grant of that Account at
-- once without touching a row.
--
-- A grant is valid only while all of these hold, and each is checked here and nowhere else:
--   * the Auth session it belongs to still exists for that user;
--   * it is not revoked;
--   * it was issued less than 30 days ago;
--   * it was last used less than 7 days ago (last use is written at most once a minute);
--   * its epoch is at least the Account's authorization epoch;
--   * the Account's pinned Google subject is still the Auth user's one Google identity.
-- Auth's own time-box and inactivity timeout (supabase/config.toml) stay in force as well.
--
-- Same pattern as the Story 1.3 migrations: the table is in the unexposed `identity` schema with row-level
-- security on and no policies, every privilege revoked from public, anon, authenticated and service_role,
-- and the only callable surface is the `api` schema, executable by service_role alone. Functions created
-- here are closed by default (the default-privileges rules of 20261010120000_accounts.sql); each `api`
-- function is granted by name at the end. Nothing here stores a token, a cookie or a client address.

-- The authorization epoch ---------------------------------------------------------------------------

alter table identity.accounts
  add column authorization_epoch bigint not null default 1 check (authorization_epoch >= 1);

comment on column identity.accounts.authorization_epoch is
  'Raised to end every session grant issued under a lower epoch (Stories 1.4a, 1.5, 1.6). It never falls.';

-- Same guard as before, plus two things about the epoch. It only rises, so a revocation by epoch cannot be
-- undone. And a change of status raises it by one in the same update, whatever changes the status and
-- whether or not the caller remembers: every grant issued before a disable is stale for good, so enabling
-- the Account again cannot bring an old session back (Stories 1.5 and 1.6 do not have to remember to).
create or replace function identity.guard_account() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.id <> old.id or new.user_id <> old.user_id or new.google_subject <> old.google_subject
     or new.source <> old.source or new.created_at <> old.created_at then
    raise exception 'an Account cannot change its identity' using errcode = '55000';
  end if;
  if new.authorization_epoch < old.authorization_epoch then
    raise exception 'an authorization epoch only rises' using errcode = '55000';
  end if;
  if new.status <> old.status then
    new.authorization_epoch := greatest(new.authorization_epoch, old.authorization_epoch + 1);
    perform identity.record_audit('system:accounts', 'account.epoch_raised', 'account:' || old.id::text);
  end if;
  return new;
end;
$$;

-- Session grants -------------------------------------------------------------------------------------

-- session_id is Auth's own session ID, taken by the server from the verified access token and never from
-- a client. There is deliberately no foreign key to auth.sessions: Auth deletes a session when it ends
-- and a grant row must outlive that to stay a record; authorization checks that the session exists when a
-- grant is issued. The Account reference is RESTRICT like every other Account reference.
create table identity.session_grants (
  session_id uuid primary key,
  account_id uuid not null references identity.accounts (id) on delete restrict,
  -- The Account's authorization epoch when the grant was issued.
  epoch bigint not null check (epoch >= 1),
  issued_at timestamptz not null default clock_timestamp(),
  last_used_at timestamptz not null default clock_timestamp(),
  revoked_at timestamptz,
  revoked_by text check (revoked_by is null or revoked_by ~ '^[a-z][a-z_]*(:[A-Za-z0-9_-]{1,64}){0,2}$'),
  revoked_reason text check (revoked_reason is null or revoked_reason ~ '^[a-z][a-z_]{0,39}$'),
  check ((revoked_at is null) = (revoked_by is null) and (revoked_at is null) = (revoked_reason is null)),
  check (last_used_at >= issued_at)
);

create index session_grants_live on identity.session_grants (account_id) where revoked_at is null;

comment on table identity.session_grants is
  'One grant per Auth session, issued when the session becomes an active Account''s. Checked on every private request; ended by api.revoke_grants.';

-- What a grant is can never change, and a revoked grant is final. The two timestamps stay writable: last
-- use is moved by authorization, and an operator or a test may need to age a grant.
create function identity.guard_session_grant() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.session_id <> old.session_id or new.account_id <> old.account_id or new.epoch <> old.epoch then
    raise exception 'a session grant cannot change its session, Account or epoch' using errcode = '55000';
  end if;
  if old.revoked_at is not null
     and (new.revoked_at is distinct from old.revoked_at or new.revoked_by is distinct from old.revoked_by
          or new.revoked_reason is distinct from old.revoked_reason) then
    raise exception 'a revoked session grant is final' using errcode = '55000';
  end if;
  return new;
end;
$$;

create trigger session_grants_guard before update on identity.session_grants
  for each row execute function identity.guard_session_grant();

alter table identity.session_grants enable row level security;
-- No policies: only the owner and roles that bypass RLS can read a row, and the revoke below leaves
-- anon, authenticated and service_role no path to the table at all.
revoke all on table identity.session_grants from public, anon, authenticated, service_role;

-- Internal helper (identity schema; callable by no API role) ----------------------------------------

-- Whether the pinned Google subject is still the Auth user's identity: the user has exactly one Google
-- identity and its subject is the pinned one. A second Google identity linked to the same Auth user (Auth
-- links by verified email, so a recycled address could add one) is a mismatch, as is a replaced subject.
create function identity.subject_pinned(p_user_id uuid, p_subject text) returns boolean
language sql
stable
set search_path = ''
as $$
  select coalesce(
    (select count(*) = 1 and min(i.provider_id) = p_subject
       from auth.identities i
      where i.user_id = p_user_id and i.provider = 'google'),
    false)
$$;

-- API ---------------------------------------------------------------------------------------------------

create type api.grant_receipt as (outcome text, account_id uuid, epoch bigint);
create type api.session_authorization as (state text, account_id uuid, workspace_id uuid, role text, epoch bigint);
-- revoked: grants ended. live: of those, the ones that were still valid, which is the number of sessions a
-- person is told were signed out (a grant that had already expired, idled out or lost its Auth session is
-- cleaned up but was not a session in use).
create type api.grant_revocation as (revoked integer, live integer);
create type api.preflight_result as (ok boolean);
create type api.registration_confirmation as (confirmed boolean);
create type api.epoch_receipt as (account_id uuid, epoch bigint);

-- Issues the grant of a signed-in session once it is an active Account's. Both IDs come from the server:
-- the user from Auth's verified user, the session from the verified access token. Idempotent: a session
-- has one grant, and a repeat changes nothing. Never revives a revoked grant.
--   issued | exists
--   revoked | expired | idle | stale (the session already has a grant, and it is not a valid one)
--   no_account | disabled | no_session (Auth has no such session for the user) | subject_mismatch
-- A subject mismatch is audited at most once an hour per session.
create function api.issue_grant(p_user_id uuid, p_session_id uuid)
returns api.grant_receipt
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_receipt api.grant_receipt;
  v_account identity.accounts;
  v_existing identity.session_grants;
  v_inserted boolean;
  v_now timestamptz := clock_timestamp();
begin
  if p_user_id is null or p_session_id is null then
    raise exception 'invalid argument' using errcode = '22023';
  end if;

  -- Shared lock on the Account: a concurrent epoch bump waits for this grant, or this waits for the bump.
  select * into v_account from identity.accounts a where a.user_id = p_user_id for share;
  if not found then
    v_receipt.outcome := 'no_account';
    return v_receipt;
  end if;
  v_receipt.account_id := v_account.id;
  v_receipt.epoch := v_account.authorization_epoch;
  if v_account.status <> 'active' then
    v_receipt.outcome := 'disabled';
    return v_receipt;
  end if;
  if not exists (select 1 from auth.sessions s where s.id = p_session_id and s.user_id = p_user_id) then
    v_receipt.outcome := 'no_session';
    return v_receipt;
  end if;
  if not identity.subject_pinned(p_user_id, v_account.google_subject) then
    perform identity.record_audit_once('system:authorization', 'session.subject_mismatch', 'session:' || p_session_id::text);
    v_receipt.outcome := 'subject_mismatch';
    return v_receipt;
  end if;

  insert into identity.session_grants (session_id, account_id, epoch, issued_at, last_used_at)
    values (p_session_id, v_account.id, v_account.authorization_epoch, v_now, v_now)
    on conflict (session_id) do nothing
    returning true into v_inserted;
  if v_inserted then
    perform identity.record_audit('account:' || v_account.id::text, 'session.issued', 'session:' || p_session_id::text);
    v_receipt.outcome := 'issued';
    return v_receipt;
  end if;

  select * into v_existing from identity.session_grants g where g.session_id = p_session_id;
  v_receipt.outcome := case
    when v_existing.account_id <> v_account.id then 'no_session'
    when v_existing.revoked_at is not null and v_existing.revoked_reason = 'subject_mismatch' then 'subject_mismatch'
    when v_existing.revoked_at is not null then 'revoked'
    when v_existing.issued_at <= v_now - interval '30 days' then 'expired'
    when v_existing.last_used_at <= v_now - interval '7 days' then 'idle'
    when v_existing.epoch < v_account.authorization_epoch then 'stale'
    else 'exists'
  end;
  return v_receipt;
end;
$$;

comment on function api.issue_grant(uuid, uuid) is
  'Issues the one grant of a session that belongs to an active Account. Idempotent; never revives a revoked grant.';

-- The one authorization call of every private request. Returns exactly one row:
--   state       active | unregistered | disabled | no_session | no_grant | revoked | expired | idle | stale_epoch
--               | subject_mismatch
--   account_id, workspace_id, role, epoch   the Account's own (the epoch is its current authorization
--               epoch); all null unless the state is active
-- Only `active` is access. The user has no Account: unregistered. The Account is disabled: disabled.
-- Otherwise the Auth session must still exist for the user (a primary-key lookup: a grant whose Auth session
-- is gone is refused long before it expires) and hold a grant of this Account that is not revoked, was issued
-- within 30 days, was last used within 7 days and carries an epoch at least the Account's, and the pinned
-- Google subject must still be the Auth user's identity. A mismatch revokes this session's grant, audits it
-- once, and from then on this session keeps answering subject_mismatch, so every later request still signs
-- the identity out. A valid grant's last use is written at most once a minute, and never waits for another
-- request's write.
create function api.authorize_session(p_user_id uuid, p_session_id uuid)
returns api.session_authorization
language plpgsql
security definer
set search_path = ''
as $$
declare
  c_max_age constant interval := interval '30 days';
  c_max_idle constant interval := interval '7 days';
  c_touch constant interval := interval '1 minute';
  v_now timestamptz := clock_timestamp();
  v_result api.session_authorization;
  v_account identity.accounts;
  v_grant identity.session_grants;
begin
  if p_user_id is null or p_session_id is null then
    raise exception 'invalid argument' using errcode = '22023';
  end if;

  select * into v_account from identity.accounts a where a.user_id = p_user_id;
  if not found then
    v_result.state := 'unregistered';
    return v_result;
  end if;
  if v_account.status <> 'active' then
    v_result.state := 'disabled';
    return v_result;
  end if;

  if not exists (select 1 from auth.sessions s where s.id = p_session_id and s.user_id = p_user_id) then
    v_result.state := 'no_session';
    return v_result;
  end if;

  select * into v_grant from identity.session_grants g where g.session_id = p_session_id and g.account_id = v_account.id;
  if not found then
    v_result.state := 'no_grant';
  elsif v_grant.revoked_at is not null then
    v_result.state := case when v_grant.revoked_reason = 'subject_mismatch' then 'subject_mismatch' else 'revoked' end;
  elsif v_grant.issued_at <= v_now - c_max_age then
    v_result.state := 'expired';
  elsif v_grant.last_used_at <= v_now - c_max_idle then
    v_result.state := 'idle';
  elsif v_grant.epoch < v_account.authorization_epoch then
    v_result.state := 'stale_epoch';
  elsif not identity.subject_pinned(p_user_id, v_account.google_subject) then
    update identity.session_grants g
       set revoked_at = v_now, revoked_by = 'system:authorization', revoked_reason = 'subject_mismatch'
     where g.session_id = p_session_id and g.revoked_at is null;
    -- Audited when this call is the one that revoked the grant (a concurrent request may have won).
    if found then
      perform identity.record_audit('system:authorization', 'session.subject_mismatch', 'session:' || p_session_id::text);
    end if;
    v_result.state := 'subject_mismatch';
  else
    perform 1 from identity.session_grants g
     where g.session_id = p_session_id and g.last_used_at <= v_now - c_touch
       for update skip locked;
    if found then
      update identity.session_grants g set last_used_at = v_now where g.session_id = p_session_id;
    end if;
    v_result.state := 'active';
    v_result.account_id := v_account.id;
    v_result.role := v_account.role;
    v_result.epoch := v_account.authorization_epoch;
    select w.id into v_result.workspace_id from projects.workspaces w where w.account_id = v_account.id;
  end if;
  return v_result;
end;
$$;

comment on function api.authorize_session(uuid, uuid) is
  'The live authorization of a private request: Account state, then the session grant, then the pinned Google subject. Only state active is access.';

-- The one revocation primitive. Exactly one selector:
--   a session        p_session_id (with p_user_id, optionally, to require that the grant is that user's)
--   an Account       p_account_id (with p_except_session_id, optionally, to leave one session standing)
--   below an epoch   p_account_id and p_below_epoch (every grant of the Account issued under a lower epoch)
-- Returns how many grants it ended (revoked) and how many of those were still valid (live). A grant that is
-- already revoked is left as it was (revocation is final) and is not counted; asking for a session that has
-- no grant ends nothing and is not an error. One audit event per grant ended, written through
-- identity.record_audit. p_reason says why (sign_out, sign_out_others, disabled, recovery, ...).
-- By Account or below an epoch it first takes the Account row FOR UPDATE, which issue_grant holds FOR SHARE
-- while it issues: a grant being issued at that moment is either in the table when the revocation reads it,
-- or issued after the revocation (a new sign-in), never missed.
create function api.revoke_grants(
  p_actor text,
  p_reason text,
  p_session_id uuid default null,
  p_user_id uuid default null,
  p_account_id uuid default null,
  p_except_session_id uuid default null,
  p_below_epoch bigint default null
)
returns api.grant_revocation
language plpgsql
security definer
set search_path = ''
as $$
declare
  c_max_age constant interval := interval '30 days';
  c_max_idle constant interval := interval '7 days';
  v_mode text;
  v_now timestamptz := clock_timestamp();
  v_result api.grant_revocation;
  v_row record;
begin
  if p_actor is null or p_actor !~ '^[a-z][a-z_]*(:[A-Za-z0-9_-]{1,64}){0,2}$'
     or p_reason is null or p_reason !~ '^[a-z][a-z_]{0,39}$' then
    raise exception 'invalid argument' using errcode = '22023';
  end if;

  v_mode := case
    when p_session_id is not null and p_account_id is null and p_except_session_id is null and p_below_epoch is null then 'session'
    when p_account_id is not null and p_session_id is null and p_user_id is null and p_below_epoch is null then 'account'
    when p_account_id is not null and p_below_epoch is not null and p_session_id is null and p_user_id is null and p_except_session_id is null then 'epoch'
    else null
  end;
  if v_mode is null or (v_mode = 'epoch' and p_below_epoch < 1) then
    raise exception 'invalid argument' using errcode = '22023';
  end if;

  if v_mode <> 'session' then
    perform 1 from identity.accounts a where a.id = p_account_id for update;
  end if;

  v_result.revoked := 0;
  v_result.live := 0;
  for v_row in
    update identity.session_grants g
       set revoked_at = v_now, revoked_by = p_actor, revoked_reason = p_reason
     where g.revoked_at is null
       and case v_mode
             when 'session' then g.session_id = p_session_id
               and (p_user_id is null or exists (select 1 from identity.accounts a where a.id = g.account_id and a.user_id = p_user_id))
             when 'account' then g.account_id = p_account_id and g.session_id is distinct from p_except_session_id
             else g.account_id = p_account_id and g.epoch < p_below_epoch
           end
    returning g.session_id,
              (g.issued_at > v_now - c_max_age
               and g.last_used_at > v_now - c_max_idle
               and g.epoch >= (select a.authorization_epoch from identity.accounts a where a.id = g.account_id)
               and exists (select 1 from auth.sessions s join identity.accounts a on a.user_id = s.user_id
                            where s.id = g.session_id and a.id = g.account_id)) as live
  loop
    perform identity.record_audit(p_actor, 'session.revoked', 'session:' || v_row.session_id::text);
    v_result.revoked := v_result.revoked + 1;
    if v_row.live then
      v_result.live := v_result.live + 1;
    end if;
  end loop;
  return v_result;
end;
$$;

comment on function api.revoke_grants(text, text, uuid, uuid, uuid, uuid, bigint) is
  'Ends session grants by session, by Account (optionally sparing one session) or below an epoch. Final, audited, idempotent.';

-- Raises the Account's authorization epoch by one: every grant issued under the old epoch is refused from
-- now on, and grants issued afterwards carry the new one. epoch is null when there is no such Account.
create function api.raise_authorization_epoch(p_account_id uuid, p_actor text)
returns api.epoch_receipt
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_receipt api.epoch_receipt;
begin
  if p_account_id is null or p_actor is null or p_actor !~ '^[a-z][a-z_]*(:[A-Za-z0-9_-]{1,64}){0,2}$' then
    raise exception 'invalid argument' using errcode = '22023';
  end if;
  v_receipt.account_id := p_account_id;
  update identity.accounts a set authorization_epoch = a.authorization_epoch + 1
   where a.id = p_account_id
   returning a.authorization_epoch into v_receipt.epoch;
  if v_receipt.epoch is not null then
    perform identity.record_audit(p_actor, 'account.epoch_raised', 'account:' || p_account_id::text);
  end if;
  return v_receipt;
end;
$$;

comment on function api.raise_authorization_epoch(uuid, text) is
  'Raises an Account''s authorization epoch, which ends every older session grant of the Account at once. Audited.';

-- Whether a registration command really created this user's Account with this code: the command is on the
-- ledger, belongs to the user's Account and carries the same code hash. It is how a registration that was
-- retried after its answer was lost (the Account exists but the session never got its grant) proves it is
-- the same command, as opposed to anyone else who merely holds a session of a user that has an Account.
-- Read-only; the hash is the HMAC the application computes, never the code.
create function api.confirm_registration(p_user_id uuid, p_command_id uuid, p_code_hash text)
returns api.registration_confirmation
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_result api.registration_confirmation;
begin
  if p_user_id is null or p_command_id is null or p_code_hash is null or p_code_hash !~ '^[0-9a-f]{64}$' then
    raise exception 'invalid argument' using errcode = '22023';
  end if;
  select exists (
    select 1 from identity.registration_commands rc join identity.accounts a on a.id = rc.account_id
     where rc.command_id = p_command_id and rc.code_hash = p_code_hash and a.user_id = p_user_id and a.status = 'active'
  ) into v_result.confirmed;
  return v_result;
end;
$$;

comment on function api.confirm_registration(uuid, uuid, text) is
  'True when this command (and code hash) created this user''s active Account: the proof a retried registration needs to get its session''s grant.';

-- The hosted preflight (check-env --live, and the Vercel build). It really reads the four tables the gate
-- depends on, so a missing privilege on an `auth` table, an unapplied migration or an unexposed schema fails
-- the build with one line instead of failing every private request after the deploy. It reads at most one row
-- of each and writes nothing.
create function api.preflight()
returns api.preflight_result
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_result api.preflight_result;
begin
  perform 1 from identity.session_grants limit 1;
  perform 1 from identity.accounts limit 1;
  perform 1 from auth.sessions limit 1;
  perform 1 from auth.identities limit 1;
  v_result.ok := true;
  return v_result;
end;
$$;

comment on function api.preflight() is
  'Reads identity.session_grants, identity.accounts, auth.sessions and auth.identities (one row each at most) and answers ok. Read-only.';

-- Access ------------------------------------------------------------------------------------------------

-- These functions are closed by default; only the service role is let in, by name. (No blanket revoke on
-- the api schema here: it would undo the grants of the earlier migrations.)
grant execute on function api.issue_grant(uuid, uuid) to service_role;
grant execute on function api.authorize_session(uuid, uuid) to service_role;
grant execute on function api.revoke_grants(text, text, uuid, uuid, uuid, uuid, bigint) to service_role;
grant execute on function api.raise_authorization_epoch(uuid, text) to service_role;
grant execute on function api.preflight() to service_role;
grant execute on function api.confirm_registration(uuid, uuid, text) to service_role;
