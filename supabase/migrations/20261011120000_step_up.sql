-- Story 1.4b: step-up (fresh authentication) records and their API.
--
-- A sensitive action (administration, deleting an owned Project or Export, deleting an Account, closing the
-- instance; later stories) needs proof that the person has just signed in again. The proof is server
-- controlled: a nonce is started from a session that already holds a valid grant, the person repeats the
-- Google sign-in on that same browser, and the callback hands the NEW Auth session to
-- api.complete_step_up, which accepts it only if Auth's own tables show a deliberate new sign-in by the same
-- person. Acceptance writes a 5-minute marker for the new session alone, and ends the initiating session's
-- grant. The marker is a Postgres row, never a JWT claim or a Redis key.
--
--   identity.step_up_nonces        one row per start. At most one is open per Account (a new start voids the
--                                  old one), it lives 10 minutes, and the count of starts in the last hour
--                                  (10 allowed) is read from these rows. It stores only hashes: the hash of
--                                  the secret that sits in an httpOnly cookie on the initiating browser, the
--                                  PKCE challenge of the Google sign-in this start began (the hash of that
--                                  flow's verifier, which only the initiating browser holds), and a hash of
--                                  the verified email at the start.
--   identity.fresh_authentications the markers: (session, action class), valid 5 minutes, and consumed by
--                                  use for the classes that destroy something.
--
--   api.start_step_up      starts a nonce for a session that holds a valid grant.
--   api.complete_step_up   accepts or rejects a completed sign-in, in one transaction.
--   api.use_marker         checks (and for two classes consumes) the marker of a session.
--
-- Same pattern as the earlier migrations: tables in the unexposed `identity` schema, row-level security on
-- with no policies, every privilege revoked from public, anon, authenticated and service_role, and a callable
-- surface in `api` that only service_role may execute. Nothing here stores a cookie secret, a verifier, a
-- token, an email address or a client address; an audit event carries opaque targets only.

-- Step-up nonces -------------------------------------------------------------------------------------

create table identity.step_up_nonces (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references identity.accounts (id) on delete restrict,
  -- The session that started it (the initiating session). No foreign key: Auth deletes a session when it
  -- ends, and this row must outlive that to stay a record.
  session_id uuid not null,
  action_class text not null check (action_class in ('administration', 'owner_deletion', 'account_deletion', 'close_instance')),
  -- SHA-256 (hex) of the random secret in the initiating browser's httpOnly cookie. The secret is never stored.
  secret_hash text not null unique check (secret_hash ~ '^[0-9a-f]{64}$'),
  -- The S256 challenge of the PKCE flow this start began: base64url of the SHA-256 of that flow's verifier. The
  -- callback hashes the verifier it finds on the browser and compares, so a sign-in started any other way
  -- is not mistaken for this one.
  verifier_hash text not null check (verifier_hash ~ '^[A-Za-z0-9_-]{43}$'),
  -- SHA-256 (hex) of lower(verified Google email) at the start (both sides lower-case it, so an address that differs
  -- only in case is the same person): the same person must sign in again. Only the hash is ever compared.
  email_hash text not null check (email_hash ~ '^[0-9a-f]{64}$'),
  started_at timestamptz not null default clock_timestamp(),
  expires_at timestamptz not null,
  status text not null default 'open' check (status in ('open', 'completed', 'voided', 'rejected', 'expired')),
  ended_at timestamptz,
  -- The new session a completed step-up accepted.
  completed_session_id uuid,
  check (expires_at > started_at),
  check ((status = 'open') = (ended_at is null)),
  check ((status = 'completed') = (completed_session_id is not null))
);

-- One open nonce per Account: a new start voids the old one first.
create unique index step_up_nonces_one_open on identity.step_up_nonces (account_id) where status = 'open';
-- The hourly start count reads these rows.
create index step_up_nonces_starts on identity.step_up_nonces (account_id, started_at);

comment on table identity.step_up_nonces is
  'Server-controlled step-up starts: hashed cookie secret, hashed PKCE flow, 10-minute life, one open per Account. Counted for the 10-an-hour limit.';

-- What a nonce is can never change, and an ended one is final. The two timestamps stay writable, like a
-- grant's: an operator or a test may need to age one.
create function identity.guard_step_up_nonce() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.id <> old.id or new.account_id <> old.account_id or new.session_id <> old.session_id
     or new.action_class <> old.action_class or new.secret_hash <> old.secret_hash
     or new.verifier_hash <> old.verifier_hash or new.email_hash <> old.email_hash then
    raise exception 'a step-up nonce cannot change what it is' using errcode = '55000';
  end if;
  if old.status <> 'open'
     and (new.status <> old.status or new.ended_at is distinct from old.ended_at or new.completed_session_id is distinct from old.completed_session_id) then
    raise exception 'an ended step-up nonce is final' using errcode = '55000';
  end if;
  return new;
end;
$$;

create trigger step_up_nonces_guard before update on identity.step_up_nonces
  for each row execute function identity.guard_step_up_nonce();

-- Fresh-authentication markers ---------------------------------------------------------------------------

create table identity.fresh_authentications (
  -- The NEW session that signed in again, and only that one.
  session_id uuid not null,
  action_class text not null check (action_class in ('administration', 'owner_deletion', 'account_deletion', 'close_instance')),
  account_id uuid not null references identity.accounts (id) on delete restrict,
  nonce_id uuid not null unique references identity.step_up_nonces (id) on delete restrict,
  -- When the step-up that earned this marker was started. A destructive command that shows its confirmation
  -- first asks for a marker whose step-up started after that moment.
  step_up_started_at timestamptz not null,
  issued_at timestamptz not null default clock_timestamp(),
  expires_at timestamptz not null,
  consumed_at timestamptz,
  primary key (session_id, action_class),
  check (expires_at > issued_at),
  check (consumed_at is null or consumed_at >= issued_at)
);

create index fresh_authentications_account on identity.fresh_authentications (account_id);

comment on table identity.fresh_authentications is
  'Fresh-authentication markers: (new session, action class), valid 5 minutes; consumed by use for account_deletion and close_instance. Never a JWT claim or a Redis key.';

-- What a marker is can never change; it is consumed at most once and the consumption is final. The two
-- timestamps stay writable so an operator or a test may age one.
create function identity.guard_fresh_authentication() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.session_id <> old.session_id or new.action_class <> old.action_class or new.account_id <> old.account_id
     or new.nonce_id <> old.nonce_id or new.step_up_started_at <> old.step_up_started_at then
    raise exception 'a fresh-authentication marker cannot change what it is' using errcode = '55000';
  end if;
  if old.consumed_at is not null and new.consumed_at is distinct from old.consumed_at then
    raise exception 'a consumed fresh-authentication marker is final' using errcode = '55000';
  end if;
  return new;
end;
$$;

create trigger fresh_authentications_guard before update on identity.fresh_authentications
  for each row execute function identity.guard_fresh_authentication();

alter table identity.step_up_nonces enable row level security;
alter table identity.fresh_authentications enable row level security;
-- No policies: only the owner and roles that bypass RLS can read a row, and the revoke below leaves anon,
-- authenticated and service_role no path to the tables at all.
revoke all on table identity.step_up_nonces from public, anon, authenticated, service_role;
revoke all on table identity.fresh_authentications from public, anon, authenticated, service_role;

-- API ---------------------------------------------------------------------------------------------------

create type api.step_up_start as (outcome text, expires_at timestamptz);
-- outcome: not_step_up | accepted | rejected. reason says which: unknown or other_flow for not_step_up; for
-- rejected one of expired, replaced, used, disabled, mismatch, same_session, no_session, old_sign_in or
-- grant_<outcome of api.issue_grant>. action_class is set once the nonce is known.
create type api.step_up_receipt as (outcome text, reason text, action_class text);
create type api.marker_use as (outcome text);

-- Starts a step-up for a session that already holds a valid grant. Both IDs come from the server (the
-- verified user and the session of the verified access token); the secret and the PKCE challenge are hashes
-- the server computed. In one transaction, serialized per Account:
--   * the Account must be active, the session's grant valid (api.authorize_session says active), and the Auth
--     user's one verified Google identity must be the pinned subject: anything else is `refused`;
--   * at most 10 starts in the last hour, counted from the nonce rows: the 11th is `limited` (audited once an
--     hour, and nothing is started or voided);
--   * any open nonce of the Account is voided, and a new one is written that lives 10 minutes.
--   started | limited | refused
create function api.start_step_up(p_user_id uuid, p_session_id uuid, p_action_class text, p_secret_hash text, p_verifier_hash text)
returns api.step_up_start
language plpgsql
security definer
set search_path = ''
as $$
declare
  c_ttl constant interval := interval '10 minutes';
  c_window constant interval := interval '1 hour';
  c_limit constant integer := 10;
  v_now timestamptz;
  v_result api.step_up_start;
  v_account identity.accounts;
  v_authorization api.session_authorization;
  v_google record;
begin
  if p_user_id is null or p_session_id is null
     or p_action_class is null or p_action_class not in ('administration', 'owner_deletion', 'account_deletion', 'close_instance')
     or p_secret_hash is null or p_secret_hash !~ '^[0-9a-f]{64}$'
     or p_verifier_hash is null or p_verifier_hash !~ '^[A-Za-z0-9_-]{43}$' then
    raise exception 'invalid argument' using errcode = '22023';
  end if;

  select * into v_account from identity.accounts a where a.user_id = p_user_id for share;
  if not found or v_account.status <> 'active' then
    v_result.outcome := 'refused';
    return v_result;
  end if;

  -- Two starts of one Account queue here, so the count below and the voiding cannot race each other.
  perform pg_advisory_xact_lock(hashtextextended('nova3d/step-up/' || v_account.id::text, 0));
  -- The start is when the lock is held, not when the call began: a call that waited for another start of the same
  -- Account must not carry a start time (and a sign-in cutoff, and an expiry) from before the wait.
  v_now := clock_timestamp();

  -- Every comparison below is `is distinct from`, so a NULL (no authorization row, no identity, no subject) refuses
  -- instead of falling through as "not different".
  select * into v_authorization from api.authorize_session(p_user_id, p_session_id);
  if v_authorization.state is distinct from 'active' or v_authorization.account_id is distinct from v_account.id then
    v_result.outcome := 'refused';
    return v_result;
  end if;

  select g.verified_email, g.google_subject into v_google from identity.verified_google(p_user_id) g;
  if not found or v_google.verified_email is null or v_google.google_subject is distinct from v_account.google_subject then
    v_result.outcome := 'refused';
    return v_result;
  end if;

  if (select count(*) from identity.step_up_nonces n where n.account_id = v_account.id and n.started_at > v_now - c_window) >= c_limit then
    perform identity.record_audit_once('system:step_up', 'step_up.limited', 'account:' || v_account.id::text);
    v_result.outcome := 'limited';
    return v_result;
  end if;

  update identity.step_up_nonces n set status = 'voided', ended_at = v_now
   where n.account_id = v_account.id and n.status = 'open';

  insert into identity.step_up_nonces (account_id, session_id, action_class, secret_hash, verifier_hash, email_hash, started_at, expires_at)
    values (v_account.id, p_session_id, p_action_class, p_secret_hash, p_verifier_hash,
            encode(sha256(convert_to(lower(v_google.verified_email), 'utf8')), 'hex'), v_now, v_now + c_ttl)
    returning expires_at into v_result.expires_at;
  perform identity.record_audit('user:' || p_user_id::text, 'step_up.started', 'account:' || v_account.id::text);
  v_result.outcome := 'started';
  return v_result;
end;
$$;

comment on function api.start_step_up(uuid, uuid, text, text, text) is
  'Starts a step-up nonce for a session with a valid grant: one open per Account, 10 minutes, 10 starts an hour per Account. Audited.';

-- Accepts or rejects a completed Google sign-in. The server passes the NEW session (the one in the access token
-- the code exchange just returned, for the user Auth then vouched for) and the two hashes it computed from this
-- browser's cookie secret and PKCE verifier; the database reads everything else from its own tables, and
-- never from the caller.
--   not_step_up   the secret names no nonce (unknown), or the verifier is not the one this nonce's flow began
--                 (other_flow): this sign-in is not the step-up, so nothing changes and nothing is audited
--   rejected      this IS the nonce's flow, but it cannot be accepted. A nonce that was still open is ended
--                 (rejected, or expired), so it cannot be tried again. Audited as step_up.rejected.<reason>
--                 against the nonce's Account (the new session's ID would not outlive its Auth session).
--                 The new session gets no grant and no marker; the caller ends only that session (local scope).
--   accepted      the new session has a grant, a marker for the nonce's class, and the initiating session's
--                 grant is revoked (reason step_up)
-- Accepted only if ALL of these hold: the nonce is open and less than 10 minutes old (not replaced by a newer
-- start); the Account is active and belongs to this Auth user; the session is not the initiating one and is
-- one Auth has for this user; Auth's own mfa_amr_claims has an `oauth` row for it created at or after the
-- nonce start (never an `amr` from a token); the user's one verified Google identity has the same email as at
-- the start and the pinned subject; and the session can be given a grant the normal way.
create function api.complete_step_up(p_user_id uuid, p_session_id uuid, p_secret_hash text, p_verifier_hash text)
returns api.step_up_receipt
language plpgsql
security definer
set search_path = ''
as $$
declare
  c_marker_ttl constant interval := interval '5 minutes';
  v_now timestamptz;
  v_result api.step_up_receipt;
  v_nonce identity.step_up_nonces;
  v_account identity.accounts;
  v_google record;
  v_grant api.grant_receipt;
  v_reason text;
begin
  if p_user_id is null or p_session_id is null
     or p_secret_hash is null or p_secret_hash !~ '^[0-9a-f]{64}$'
     or p_verifier_hash is null or p_verifier_hash !~ '^[A-Za-z0-9_-]{43}$' then
    raise exception 'invalid argument' using errcode = '22023';
  end if;

  select * into v_nonce from identity.step_up_nonces n where n.secret_hash = p_secret_hash for update;
  -- Taken once the row lock is held: a completion that waited for another one judges expiry, and starts the
  -- marker's five minutes, from the moment it can act.
  v_now := clock_timestamp();
  if not found then
    v_result.outcome := 'not_step_up';
    v_result.reason := 'unknown';
    return v_result;
  end if;
  if v_nonce.verifier_hash <> p_verifier_hash then
    v_result.outcome := 'not_step_up';
    v_result.reason := 'other_flow';
    return v_result;
  end if;
  v_result.action_class := v_nonce.action_class;

  -- From here on this is the flow the nonce began.
  if v_nonce.status <> 'open' then
    v_reason := case v_nonce.status when 'voided' then 'replaced' when 'expired' then 'expired' else 'used' end;
  elsif v_nonce.expires_at <= v_now then
    update identity.step_up_nonces n set status = 'expired', ended_at = v_now where n.id = v_nonce.id;
    v_reason := 'expired';
  else
    select * into v_account from identity.accounts a where a.id = v_nonce.account_id for share;
    v_reason := case
      when v_account.status is distinct from 'active' then 'disabled'
      when v_account.user_id is distinct from p_user_id then 'mismatch'
      when p_session_id = v_nonce.session_id then 'same_session'
      when not exists (select 1 from auth.sessions s where s.id = p_session_id and s.user_id = p_user_id) then 'no_session'
      when not exists (
        select 1 from auth.mfa_amr_claims c
         where c.session_id = p_session_id and c.authentication_method = 'oauth' and c.created_at >= v_nonce.started_at
      ) then 'old_sign_in'
      else null
    end;
    if v_reason is null then
      select g.verified_email, g.google_subject into v_google from identity.verified_google(p_user_id) g;
      if not found or v_google.verified_email is null
         or v_google.google_subject is distinct from v_account.google_subject
         or encode(sha256(convert_to(lower(v_google.verified_email), 'utf8')), 'hex') is distinct from v_nonce.email_hash then
        v_reason := 'mismatch';
      end if;
    end if;
    if v_reason is null then
      select * into v_grant from api.issue_grant(p_user_id, p_session_id);
      if v_grant.outcome not in ('issued', 'exists') then
        v_reason := 'grant_' || v_grant.outcome;
      end if;
    end if;
    if v_reason is not null then
      update identity.step_up_nonces n set status = 'rejected', ended_at = v_now where n.id = v_nonce.id;
    end if;
  end if;

  if v_reason is not null then
    -- The audit event names the Account whose step-up it was and, in the action, why: the new session's ID would be
    -- the only other handle, and it is gone as soon as Auth deletes that session.
    perform identity.record_audit('system:step_up', 'step_up.rejected.' || v_reason, 'account:' || v_nonce.account_id::text);
    v_result.outcome := 'rejected';
    v_result.reason := v_reason;
    return v_result;
  end if;

  -- Accepted: the new session's grant exists (issued above); now the marker, the old grant and the nonce.
  perform api.revoke_grants(
    p_actor => 'user:' || p_user_id::text,
    p_reason => 'step_up',
    p_session_id => v_nonce.session_id,
    p_user_id => p_user_id
  );
  insert into identity.fresh_authentications (session_id, action_class, account_id, nonce_id, step_up_started_at, issued_at, expires_at)
    values (p_session_id, v_nonce.action_class, v_account.id, v_nonce.id, v_nonce.started_at, v_now, v_now + c_marker_ttl);
  update identity.step_up_nonces n set status = 'completed', ended_at = v_now, completed_session_id = p_session_id where n.id = v_nonce.id;
  perform identity.record_audit('user:' || p_user_id::text, 'step_up.completed', 'session:' || p_session_id::text);
  v_result.outcome := 'accepted';
  return v_result;
end;
$$;

comment on function api.complete_step_up(uuid, uuid, text, text) is
  'Accepts a completed step-up sign-in only for a new session of the same person (Auth''s own tables decide), then issues its grant, writes its 5-minute marker, revokes the initiating grant and consumes the nonce. Otherwise rejects it or says it is not a step-up.';

-- Checks the marker of a session for an action class, inside the sensitive command's own transaction (a later
-- story's function calls this one). The session must hold a valid grant of an active Account (a revoked or
-- stale session has no use for a marker), and the marker must be this session's own, for this class,
-- unexpired and unused. administration and owner_deletion markers stay reusable until they expire (5
-- minutes). account_deletion and close_instance markers are consumed by use, and a caller must say after
-- what moment the step-up has to have started (p_started_after: the time its destructive confirmation was
-- shown); a marker earned by an earlier step-up is `stale`. p_started_after is applied to the other classes
-- when given.
--   allowed | none (no marker for this session and class) | expired | used | stale | denied (the session is
--   not an active Account's with a valid grant)
create function api.use_marker(p_user_id uuid, p_session_id uuid, p_action_class text, p_started_after timestamptz default null)
returns api.marker_use
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_now timestamptz;
  v_result api.marker_use;
  v_authorization api.session_authorization;
  v_marker identity.fresh_authentications;
  v_consumed boolean;
begin
  if p_user_id is null or p_session_id is null
     or p_action_class is null or p_action_class not in ('administration', 'owner_deletion', 'account_deletion', 'close_instance') then
    raise exception 'invalid argument' using errcode = '22023';
  end if;
  v_consumed := p_action_class in ('account_deletion', 'close_instance');
  if v_consumed and p_started_after is null then
    raise exception 'invalid argument' using errcode = '22023';
  end if;

  select * into v_authorization from api.authorize_session(p_user_id, p_session_id);
  if v_authorization.state is distinct from 'active' or v_authorization.account_id is null then
    v_result.outcome := 'denied';
    return v_result;
  end if;

  select * into v_marker from identity.fresh_authentications m
   where m.session_id = p_session_id and m.action_class = p_action_class and m.account_id = v_authorization.account_id
     for update;
  v_now := clock_timestamp();
  if not found then
    v_result.outcome := 'none';
  elsif v_marker.consumed_at is not null then
    v_result.outcome := 'used';
  elsif v_marker.expires_at <= v_now then
    v_result.outcome := 'expired';
  elsif p_started_after is not null and v_marker.step_up_started_at <= p_started_after then
    v_result.outcome := 'stale';
  else
    if v_consumed then
      update identity.fresh_authentications m set consumed_at = v_now where m.session_id = p_session_id and m.action_class = p_action_class;
      perform identity.record_audit('user:' || p_user_id::text, 'step_up.marker_consumed', 'session:' || p_session_id::text);
    end if;
    v_result.outcome := 'allowed';
  end if;
  return v_result;
end;
$$;

comment on function api.use_marker(uuid, uuid, text, timestamptz) is
  'Checks the session''s own fresh-authentication marker for a class: reusable for 5 minutes for administration and owner_deletion, consumed by use (and needing a step-up started after a given time) for account_deletion and close_instance.';

-- The hosted preflight now also reads the two step-up tables, so an unapplied migration fails the build with
-- one line. It still reads at most one row of each and writes nothing.
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
  perform 1 from identity.session_grants limit 1;
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
  'Reads identity.session_grants, identity.accounts, identity.step_up_nonces, identity.fresh_authentications, auth.sessions, auth.identities and auth.mfa_amr_claims (one row each at most) and answers ok. Read-only.';

-- Access ------------------------------------------------------------------------------------------------

-- Closed by default; only the service role is let in, by name.
grant execute on function api.start_step_up(uuid, uuid, text, text, text) to service_role;
grant execute on function api.complete_step_up(uuid, uuid, text, text) to service_role;
grant execute on function api.use_marker(uuid, uuid, text, timestamptz) to service_role;
