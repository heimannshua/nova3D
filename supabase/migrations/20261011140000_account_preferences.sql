-- Story 1.4d: the Account-owned preferences record.
--
-- Language, light or dark, explanation detail and first-use guidance used to live only in four device
-- cookies, so they did not belong to the Account and did not follow it to another device. Identity now owns
-- one record per Account. It is returned by the live authorization of every private request
-- (api.authorize_session, one extra primary-key read and no extra round trip), and it wins over the device's
-- cookies whenever the Account has one. The cookies stay as the copy that serves pages with no Account (the
-- sign-in page, the design kit) and as the copy a change writes.
--
--   identity.account_preferences   one row per Account:
--     locale    null follows the device (Accept-Language); otherwise 'en' or 'he'
--     theme     'light' | 'dark'
--     detail    'simple' | 'technical'
--     guidance  'shown' | 'dismissed'
--   The CHECK constraints equal the allowed values in lib/preferences.ts; tests/integration/account-preferences
--   reads them back from the database and fails if the two drift apart.
--
--   api.adopt_preferences   a person's first sign-in adopts the device's cookies: inserts the record ONLY when the
--                           Account has none. created | exists | denied.
--   api.set_preference      validates one name and one value and saves it. saved | denied.
--
-- Both take the Account ID the server derived from the verified session, never a client's, and both refuse an
-- Account that is not active (denied). An invalid name or value is an invalid argument (22023), not a clamp.
--
-- Same pattern as the earlier migrations: the table is in the unexposed `identity` schema with row-level security
-- on and no policies, every privilege revoked from public, anon, authenticated and service_role, and the only
-- callable surface is the `api` schema, executable by service_role alone. Functions created here are closed by
-- default (the default-privileges rules of 20261010120000_accounts.sql); each is granted by name at the end.
-- Nothing here stores a token, a cookie or a client address, and preferences are not sensitive, so nothing is audited.

-- The record --------------------------------------------------------------------------------------------

create table identity.account_preferences (
  -- RESTRICT like every other Account reference: an Account with a record cannot be deleted by accident.
  account_id uuid primary key references identity.accounts (id) on delete restrict,
  -- Null follows the device language. A CHECK passes a null, so the list below is the set of languages.
  locale text constraint account_preferences_locale_check check (locale in ('en', 'he')),
  theme text not null default 'light' constraint account_preferences_theme_check check (theme in ('light', 'dark')),
  detail text not null default 'simple' constraint account_preferences_detail_check check (detail in ('simple', 'technical')),
  guidance text not null default 'shown' constraint account_preferences_guidance_check check (guidance in ('shown', 'dismissed')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table identity.account_preferences is
  'One preferences record per Account (Story 1.4d). Created by api.adopt_preferences or api.set_preference, changed by api.set_preference. Returned inside the active answer of api.authorize_session.';
comment on column identity.account_preferences.locale is
  'Null follows the device language (Accept-Language); otherwise en or he.';

-- Whose record it is can never change.
create function identity.guard_account_preferences() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.account_id <> old.account_id or new.created_at <> old.created_at then
    raise exception 'a preferences record cannot change its Account' using errcode = '55000';
  end if;
  return new;
end;
$$;

create trigger account_preferences_guard before update on identity.account_preferences
  for each row execute function identity.guard_account_preferences();

alter table identity.account_preferences enable row level security;
-- No policies: only the owner and roles that bypass RLS can read a row, and the revoke below leaves
-- anon, authenticated and service_role no path to the table at all.
revoke all on table identity.account_preferences from public, anon, authenticated, service_role;

-- API ---------------------------------------------------------------------------------------------------

create type api.preference_adoption as (outcome text);
create type api.preference_save as (outcome text);

-- The record rides on the active answer of the live authorization: it is read with the Account, by primary
-- key, and cannot disagree with the Account being authorized. It is null in every other state, and null when
-- the Account has no record yet.
alter type api.session_authorization add attribute preferences jsonb;

-- Adopts the device's choices as the Account's record, when the Account has none. The server passes the values
-- of the device's valid cookies (an absent or tampered one is the default, and a language no cookie chose is
-- null). Inserts only: a record that exists is never touched.
--   created   the Account had no record and now has this one
--   exists    the Account already had a record (two first requests at once: the first one won), left as it was
--   denied    no such Account, or it is not active
create function api.adopt_preferences(p_account_id uuid, p_locale text, p_theme text, p_detail text, p_guidance text)
returns api.preference_adoption
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_result api.preference_adoption;
  v_account identity.accounts;
  v_inserted boolean;
begin
  if p_account_id is null or p_theme is null or p_detail is null or p_guidance is null
     or (p_locale is not null and p_locale not in ('en', 'he'))
     or p_theme not in ('light', 'dark')
     or p_detail not in ('simple', 'technical')
     or p_guidance not in ('shown', 'dismissed') then
    raise exception 'invalid argument' using errcode = '22023';
  end if;

  -- Shared lock on the Account, like issue_grant: a concurrent disable waits for this, or this waits for it.
  select * into v_account from identity.accounts a where a.id = p_account_id for share;
  if not found or v_account.status <> 'active' then
    v_result.outcome := 'denied';
    return v_result;
  end if;

  -- Two first requests at once race for the primary key: the loser waits for the winner and inserts nothing.
  insert into identity.account_preferences (account_id, locale, theme, detail, guidance)
    values (p_account_id, p_locale, p_theme, p_detail, p_guidance)
    on conflict (account_id) do nothing
    returning true into v_inserted;
  v_result.outcome := case when v_inserted is true then 'created' else 'exists' end;
  return v_result;
end;
$$;

comment on function api.adopt_preferences(uuid, text, text, text, text) is
  'Adopts the device''s choices as the Account''s preferences record when it has none. created | exists | denied. Never changes an existing record.';

-- Saves one preference of an active Account. p_value is null only for the language: null follows the device.
-- If the Account has no record yet this creates one with the defaults for the other three (the server adopts
-- the device's cookies first, so a person who changes one setting before adoption does not lose the rest).
--   saved     the record now holds this value
--   denied    no such Account, or it is not active
create function api.set_preference(p_account_id uuid, p_name text, p_value text)
returns api.preference_save
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_result api.preference_save;
  v_account identity.accounts;
begin
  if p_account_id is null or p_name is null
     or p_name not in ('locale', 'theme', 'detail', 'guidance')
     or (p_name = 'locale' and p_value is not null and p_value not in ('en', 'he'))
     or (p_name = 'theme' and (p_value is null or p_value not in ('light', 'dark')))
     or (p_name = 'detail' and (p_value is null or p_value not in ('simple', 'technical')))
     or (p_name = 'guidance' and (p_value is null or p_value not in ('shown', 'dismissed'))) then
    raise exception 'invalid argument' using errcode = '22023';
  end if;

  select * into v_account from identity.accounts a where a.id = p_account_id for share;
  if not found or v_account.status <> 'active' then
    v_result.outcome := 'denied';
    return v_result;
  end if;

  insert into identity.account_preferences as p (account_id, locale, theme, detail, guidance)
    values (
      p_account_id,
      case when p_name = 'locale' then p_value end,
      coalesce(case when p_name = 'theme' then p_value end, 'light'),
      coalesce(case when p_name = 'detail' then p_value end, 'simple'),
      coalesce(case when p_name = 'guidance' then p_value end, 'shown')
    )
    on conflict (account_id) do update set
      locale = case when p_name = 'locale' then excluded.locale else p.locale end,
      theme = case when p_name = 'theme' then excluded.theme else p.theme end,
      detail = case when p_name = 'detail' then excluded.detail else p.detail end,
      guidance = case when p_name = 'guidance' then excluded.guidance else p.guidance end,
      updated_at = clock_timestamp();
  v_result.outcome := 'saved';
  return v_result;
end;
$$;

comment on function api.set_preference(uuid, text, text) is
  'Saves one preference (locale, theme, detail or guidance) of an active Account; a null locale follows the device. saved | denied.';

-- The live authorization (Story 1.4a) with one more attribute. Everything but the last read is exactly as
-- 20261010130000_session_grants.sql wrote it: in the active answer, the Account's preferences record, or null.
create or replace function api.authorize_session(p_user_id uuid, p_session_id uuid)
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
    -- Story 1.4d: the Account's preferences record, by primary key; null when it has none.
    select jsonb_build_object('locale', p.locale, 'theme', p.theme, 'detail', p.detail, 'guidance', p.guidance)
      into v_result.preferences
      from identity.account_preferences p where p.account_id = v_account.id;
  end if;
  return v_result;
end;
$$;

comment on function api.authorize_session(uuid, uuid) is
  'The live authorization of a private request: Account state, then the session grant, then the pinned Google subject. Only state active is access; its answer carries the Account''s preferences record (or null).';

-- The hosted preflight now also reads the preferences table, so an unapplied migration fails the build with one
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
  perform p.account_id, p.locale, p.theme, p.detail, p.guidance, p.created_at, p.updated_at from identity.account_preferences p limit 1;
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
  'Reads identity.session_grants (including its CSRF columns), identity.accounts, identity.account_preferences, identity.step_up_nonces, identity.fresh_authentications, auth.sessions, auth.identities and auth.mfa_amr_claims (one row each at most) and answers ok. Read-only.';

-- Access ------------------------------------------------------------------------------------------------

-- Closed by default; only the service role is let in, by name. (create or replace keeps the grants that
-- api.authorize_session and api.preflight already had.)
grant execute on function api.adopt_preferences(uuid, text, text, text, text) to service_role;
grant execute on function api.set_preference(uuid, text, text) to service_role;

-- A changed return type and two new functions: have the Data API reload its schema cache now.
notify pgrst, 'reload schema';
