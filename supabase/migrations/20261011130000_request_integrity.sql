-- Story 1.4c: the per-session CSRF token, as a hash on the session grant.
--
-- A mutation that is not a Server Action (a route handler under app/api) is trusted only with two proofs
-- besides the session cookie: the request comes from this application's own origin (the proxy and the route
-- helper decide that, from headers), and it carries the session's CSRF token. The token is 256 random bits
-- minted by the server; only its SHA-256 is stored here, on the grant of the session it belongs to, so a
-- stolen copy of the database cannot forge one and a token is worthless once its grant is revoked, expired or
-- stale. The browser holds the token in a cookie its own scripts can read and echoes it in a header, which a
-- page on another site can do neither.
--
--   identity.session_grants.csrf_hash       SHA-256 (hex) of the session's token, or null until one is issued
--   identity.session_grants.csrf_issued_at  when that hash was stored
--
--   api.issue_csrf    stores a hash for a session that holds a valid grant, when the grant has none or its
--                     hash is 60 seconds old or older; otherwise leaves the stored one. `issued` or `exists`.
--   api.verify_csrf   compares a hash with the grant's. `valid`, `invalid`, or `denied` (the session does not
--                     hold a valid grant of an active Account).
--
-- Why a hash is replaced only when it is a minute old or older: the proxy issues the token on the first page
-- request of a session that carries no token cookie, and two tabs can make that request at once. The first to
-- store its hash wins and sets its cookie; the second finds a fresh hash, leaves it and sets nothing, so the
-- cookie and the stored hash never end up different. A cookie lost for good is replaced on the next page
-- request after the minute.
--
-- Same pattern as the earlier migrations: the table is in the unexposed `identity` schema, the only callable
-- surface is the `api` schema, executable by service_role alone, and the functions are closed by default and
-- granted by name at the end. Nothing here stores a token, a cookie or a client address, and nothing logs.

-- The columns -------------------------------------------------------------------------------------------

alter table identity.session_grants
  add column csrf_hash text check (csrf_hash is null or csrf_hash ~ '^[0-9a-f]{64}$'),
  add column csrf_issued_at timestamptz,
  add constraint session_grants_csrf_pair check ((csrf_hash is null) = (csrf_issued_at is null));

comment on column identity.session_grants.csrf_hash is
  'SHA-256 (hex) of the session''s CSRF token (Story 1.4c). The token itself is never stored. Writable on a live grant only.';
comment on column identity.session_grants.csrf_issued_at is
  'When csrf_hash was stored. A hash 60 seconds old or older may be replaced by api.issue_csrf.';

-- Same guard as before, plus the new columns: a revoked grant is final, and that now includes its token.
create or replace function identity.guard_session_grant() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.session_id <> old.session_id or new.account_id <> old.account_id or new.epoch <> old.epoch then
    raise exception 'a session grant cannot change its session, Account or epoch' using errcode = '55000';
  end if;
  if old.revoked_at is not null
     and (new.revoked_at is distinct from old.revoked_at or new.revoked_by is distinct from old.revoked_by
          or new.revoked_reason is distinct from old.revoked_reason
          or new.csrf_hash is distinct from old.csrf_hash or new.csrf_issued_at is distinct from old.csrf_issued_at) then
    raise exception 'a revoked session grant is final' using errcode = '55000';
  end if;
  return new;
end;
$$;

-- API ---------------------------------------------------------------------------------------------------

create type api.csrf_issue as (outcome text);
create type api.csrf_check as (outcome text);

-- Stores the hash of a new CSRF token for a session that holds a valid grant. Both IDs come from the server
-- (the user from Auth's verified user, the session from the verified access token) and the hash is the
-- SHA-256 the server computed of a token it has just minted; none of them is ever a client's word. The
-- session's grant must be valid (api.authorize_session says active), and is locked while the hash is written,
-- so two calls for one session queue here and the second one sees the first one's hash:
--   issued   the grant had no hash, or its hash was 60 seconds old or older: this one is stored. The caller
--            must now deliver the token whose hash this is.
--   exists   the grant has a hash less than 60 seconds old: nothing is changed, and the caller delivers nothing.
--   denied   the session does not hold a valid grant of an active Account.
create function api.issue_csrf(p_user_id uuid, p_session_id uuid, p_csrf_hash text)
returns api.csrf_issue
language plpgsql
security definer
set search_path = ''
as $$
declare
  c_replace_after constant interval := interval '60 seconds';
  v_now timestamptz;
  v_result api.csrf_issue;
  v_authorization api.session_authorization;
  v_grant identity.session_grants;
begin
  if p_user_id is null or p_session_id is null or p_csrf_hash is null or p_csrf_hash !~ '^[0-9a-f]{64}$' then
    raise exception 'invalid argument' using errcode = '22023';
  end if;

  -- Every comparison is `is distinct from`, so a NULL (no authorization row) denies instead of falling through.
  select * into v_authorization from api.authorize_session(p_user_id, p_session_id);
  if v_authorization.state is distinct from 'active' or v_authorization.account_id is null then
    v_result.outcome := 'denied';
    return v_result;
  end if;

  select * into v_grant from identity.session_grants g
   where g.session_id = p_session_id and g.account_id = v_authorization.account_id
     for update;
  -- Taken once the row lock is held: a call that waited for another one judges the minute from the moment it can act.
  v_now := clock_timestamp();
  -- Revoked between the authorization above and the lock: not a grant any more.
  if not found or v_grant.revoked_at is not null then
    v_result.outcome := 'denied';
    return v_result;
  end if;

  if v_grant.csrf_hash is null or v_grant.csrf_issued_at <= v_now - c_replace_after then
    update identity.session_grants g set csrf_hash = p_csrf_hash, csrf_issued_at = v_now where g.session_id = p_session_id;
    v_result.outcome := 'issued';
  else
    v_result.outcome := 'exists';
  end if;
  return v_result;
end;
$$;

comment on function api.issue_csrf(uuid, uuid, text) is
  'Stores the hash of a new CSRF token on the valid grant of a session when it has none or its hash is 60 seconds old or older; otherwise leaves it. issued | exists | denied.';

-- Compares the hash of a request's CSRF token with the one stored on the session's grant. The session must
-- hold a valid grant of an active Account: a token of a revoked, expired, idle or stale grant is worth
-- nothing. A grant that has no hash yet (it predates this story, or no page has been requested) is `invalid`,
-- whatever is sent. The comparison is of two SHA-256 digests, so a timing difference reveals nothing an
-- attacker could use: it cannot choose a token to steer the digest.
--   valid | invalid | denied
create function api.verify_csrf(p_user_id uuid, p_session_id uuid, p_csrf_hash text)
returns api.csrf_check
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_result api.csrf_check;
  v_authorization api.session_authorization;
  v_grant identity.session_grants;
begin
  if p_user_id is null or p_session_id is null or p_csrf_hash is null or p_csrf_hash !~ '^[0-9a-f]{64}$' then
    raise exception 'invalid argument' using errcode = '22023';
  end if;

  select * into v_authorization from api.authorize_session(p_user_id, p_session_id);
  if v_authorization.state is distinct from 'active' or v_authorization.account_id is null then
    v_result.outcome := 'denied';
    return v_result;
  end if;

  select * into v_grant from identity.session_grants g
   where g.session_id = p_session_id and g.account_id = v_authorization.account_id;
  if not found or v_grant.revoked_at is not null then
    v_result.outcome := 'denied';
  elsif v_grant.csrf_hash is not null and v_grant.csrf_hash = p_csrf_hash then
    v_result.outcome := 'valid';
  else
    v_result.outcome := 'invalid';
  end if;
  return v_result;
end;
$$;

comment on function api.verify_csrf(uuid, uuid, text) is
  'Compares a CSRF token hash with the one on the valid grant of the session. valid | invalid | denied. Writes nothing of its own.';

-- The hosted preflight now also reads the two new columns, so an unapplied migration fails the build with one
-- line. It still reads at most one row of each table and writes nothing.
create or replace function api.preflight()
returns api.preflight_result
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_result api.preflight_result;
begin
  perform g.session_id, g.csrf_hash, g.csrf_issued_at from identity.session_grants g limit 1;
  perform 1 from identity.accounts limit 1;
  perform 1 from identity.step_up_nonces limit 1;
  perform 1 from identity.fresh_authentications limit 1;
  perform 1 from auth.sessions limit 1;
  perform 1 from auth.identities limit 1;
  perform 1 from auth.mfa_amr_claims limit 1;
  v_result.ok := true;
  return v_result;
end;
$$;

comment on function api.preflight() is
  'Reads identity.session_grants (including its CSRF columns), identity.accounts, identity.step_up_nonces, identity.fresh_authentications, auth.sessions, auth.identities and auth.mfa_amr_claims (one row each at most) and answers ok. Read-only.';

-- Access ------------------------------------------------------------------------------------------------

-- Closed by default; only the service role is let in, by name.
grant execute on function api.issue_csrf(uuid, uuid, text) to service_role;
grant execute on function api.verify_csrf(uuid, uuid, text) to service_role;
