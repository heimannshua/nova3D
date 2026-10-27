-- Story 2.5: a provider permission is bound to the Job, Project and Attempt that own the operation, and a provider reservation is answered in one fixed order.
--
-- api.reserve_cost (the 18-argument form, the only way to reserve for Anthropic or Brave) answers:
--   1. `denied`               the Account is not active under the epoch (identity.assert_operation_authority), before any grant is read;
--   2. `permission_required`  a grant argument is missing, or the operation is not the supplied Job's and Project's own;
--   3. (the Job lock `nova3d:job:<job>`, shared with every Job command and with api.grant_provider_permission)
--   4. the REPLAY: a receipt of the command ID, or a reservation of the operation, is answered by provider_private.reserve_cost_unchecked
--      (replayed | reused | already_reserved), before the grant is read, so an answer that was lost is replayed after a revoke, an expiry or the end of the Job;
--   5. `permission_required`  no live grant matches: the id, the Account, Project and Job, the category, the provider, the purpose and the outbound data (as sets)
--      all equal; not revoked, not expired; the grant's Attempt is still the Job's highest and not finished; the Project still live;
--   6. `maximum_exceeded`     the quote is `quoted` and above the grant's disclosed maximum (any other quote falls through to 7 and is refused there, truthfully);
--   7. the unchecked reservation, which answers everything else.
-- The generic form (12 arguments) refuses a permissioned provider (Anthropic, Brave) outright; any other provider (a fixture) keeps the original path.

-- The grant lives with its Attempt ---------------------------------------------------------------------------------------------------------------

alter table provider_private.permissions add column attempt_id uuid;

-- Both times come from ONE clock reading in the BEFORE INSERT trigger below. (Two defaults read the clock twice, and `expires_at <= granted_at + 7 days` could fail by a microsecond.)
-- The seven days are 168 hours: `interval '7 days'` added to a timestamptz is calendar arithmetic in the session's time zone, 167, 168 or 169 hours across a change of clock,
-- and a grant stamped in one zone could not be revoked (an UPDATE re-checks the constraint) from another.
alter table provider_private.permissions alter column granted_at drop default, alter column expires_at drop default;
alter table provider_private.permissions drop constraint provider_permissions_expiry,
  add constraint provider_permissions_expiry check (expires_at <= granted_at + interval '168 hours');

create function provider_private.stamp_permission() returns trigger
language plpgsql set search_path = '' as $$
declare v_now timestamptz := clock_timestamp();
begin
  new.granted_at := v_now;
  new.expires_at := v_now + interval '168 hours';
  return new;
end $$;
revoke all on function provider_private.stamp_permission() from public, anon, authenticated, service_role;
create trigger provider_permissions_stamp before insert on provider_private.permissions
  for each row execute function provider_private.stamp_permission();

-- A grant is written once and revoked once: the only change to a row is revoked_at, from null to a time; nothing empties the table. Delete is left for the Epic 8 purge.
create function provider_private.guard_permission_change() returns trigger
language plpgsql set search_path = '' as $$
begin
  if tg_op = 'UPDATE' and old.revoked_at is null and new.revoked_at is not null
     and (to_jsonb(new) - 'revoked_at') = (to_jsonb(old) - 'revoked_at') then
    return new;
  end if;
  raise exception 'provider_private.permissions: a grant is revoked once, never edited or emptied' using errcode = '55000';
end $$;
revoke all on function provider_private.guard_permission_change() from public, anon, authenticated, service_role;
create trigger provider_permissions_guard before update on provider_private.permissions
  for each row execute function provider_private.guard_permission_change();
create trigger provider_permissions_no_truncate before truncate on provider_private.permissions
  for each statement execute function provider_private.guard_permission_change();

-- The api functions are security definers: no role needs the table itself, so the service role loses what 20261025 gave it (a direct insert would skip the Job lock,
-- the Attempt and the Project checks of api.grant_provider_permission).
revoke all on provider_private.permissions from service_role;
-- (And the helper behind the revocation, which 20261027 left executable by it: api.revoke_provider_permission, a definer, is its only caller.)
revoke all on function provider_private.revoke_permission(uuid,uuid,uuid,uuid) from service_role;

-- Helpers ----------------------------------------------------------------------------------------------------------------------------------------

-- The 15-column refusal of a reservation that read or wrote nothing.
create function provider_private.refusal(p_outcome text) returns api.cost_reservation
language sql immutable set search_path = '' as $$
  select row(p_outcome, null::uuid, null::uuid, null::uuid, null::uuid, null::uuid, null::bigint, null::bigint, null::text, null::text, null::text,
             null::bigint, null::bigint, null::bigint, null::bigint)::api.cost_reservation
$$;
revoke all on function provider_private.refusal(text) from public, anon, authenticated, service_role;

-- The one gate: a provider that needs a grant. Case and padding do not change it, and an absent provider is refused like a permissioned one.
create function provider_private.is_permissioned_provider(p_provider text) returns boolean
language sql immutable set search_path = '' as $$
  select p_provider is null or lower(btrim(p_provider, E' \t\n\r\f\x0b')) in ('anthropic', 'brave')
$$;
revoke all on function provider_private.is_permissioned_provider(text) from public, anon, authenticated, service_role;

-- The grant: bound to the Job's highest Attempt ----------------------------------------------------------------------------------------------------

create or replace function api.grant_provider_permission(p_account_id uuid, p_project_id uuid, p_job_id uuid, p_category text, p_provider text,
  p_purpose text, p_outbound_data text[], p_disclosed_maximum_microdollars bigint)
returns setof jsonb language plpgsql security definer set search_path = '' as $$
declare v_id uuid; v_attempt_id uuid; v_state text; v_data text[];
begin
  if p_account_id is null or p_project_id is null or p_job_id is null or p_category is null or p_category not in ('research_search','synthesis_vision')
    or p_provider is null or p_provider not in ('anthropic','brave') or p_purpose is null or length(p_purpose) not between 1 and 500
    or p_outbound_data is null or cardinality(p_outbound_data) not between 1 and 8
    or p_disclosed_maximum_microdollars is null or p_disclosed_maximum_microdollars not between 1 and 1000000 then
    raise exception 'invalid provider permission' using errcode = '22023';
  end if;
  if (p_category='research_search' and (p_provider<>'brave' or p_outbound_data is distinct from array['normalized_public_subject']))
     or (p_category='synthesis_vision' and (p_provider<>'anthropic' or p_outbound_data && array['normalized_public_subject']))
     or exists (select 1 from unnest(p_outbound_data) d where d not in ('normalized_public_subject','confirmed_project_scope','project_evidence','provider_image_derivatives'))
     or cardinality(p_outbound_data)<>(select count(distinct d) from unnest(p_outbound_data) d) then
    raise exception 'invalid provider permission' using errcode = '22023';
  end if;
  -- One command at a time for the Job: the Attempt read below cannot be replaced, nor the Job finished, before this grant is written.
  perform pg_advisory_xact_lock(hashtextextended('nova3d:job:' || p_job_id::text, 0));
  if not exists (select 1 from projects.projects p where p.id=p_project_id and p.account_id=p_account_id and p.deleted_at is null)
     or not exists (select 1 from jobs.jobs j where j.id=p_job_id and j.account_id=p_account_id and j.project_id=p_project_id) then
    return;
  end if;
  select a.id, a.state into v_attempt_id, v_state from jobs.attempts a where a.job_id=p_job_id and a.account_id=p_account_id order by a.number desc limit 1;
  if not found or v_state in ('completed','failed','cancelled') then
    return;
  end if;
  select array_agg(d order by d collate "C") into v_data from unnest(p_outbound_data) d;
  insert into provider_private.permissions(account_id,project_id,job_id,attempt_id,category,provider,purpose,outbound_data,disclosed_maximum_microdollars)
    values(p_account_id,p_project_id,p_job_id,v_attempt_id,p_category,p_provider,p_purpose,v_data,p_disclosed_maximum_microdollars) returning id into v_id;
  return query select jsonb_build_object('id',x.id,'account_id',x.account_id,'project_id',x.project_id,'job_id',x.job_id,'category',x.category,
    'provider',x.provider,'purpose',x.purpose,'outbound_data',x.outbound_data,'disclosed_maximum_microdollars',x.disclosed_maximum_microdollars,
    'granted_at',x.granted_at,'expires_at',x.expires_at,'revoked_at',x.revoked_at,'job_terminal',false)
    from provider_private.permissions x where x.id=v_id;
end $$;
revoke all on function api.grant_provider_permission(uuid,uuid,uuid,text,text,text,text[],bigint) from public, anon, authenticated;
grant execute on function api.grant_provider_permission(uuid,uuid,uuid,text,text,text,text[],bigint) to service_role;

-- `job_terminal` is true when the grant is no longer live for its Attempt: the Job's highest Attempt is finished, or is another one (a retry does not revive a grant).
create or replace function api.get_provider_permission(p_account_id uuid, p_project_id uuid, p_job_id uuid, p_category text, p_provider text)
returns setof jsonb language sql security definer set search_path = '' as $$
  select jsonb_build_object('id',x.id,'account_id',x.account_id,'project_id',x.project_id,'job_id',x.job_id,'category',x.category,'provider',x.provider,
    'purpose',x.purpose,'outbound_data',x.outbound_data,'disclosed_maximum_microdollars',x.disclosed_maximum_microdollars,'granted_at',x.granted_at,
    'expires_at',x.expires_at,'revoked_at',x.revoked_at,
    'job_terminal',coalesce(not (j.id = x.attempt_id and j.state not in ('completed','failed','cancelled')), true))
  from provider_private.permissions x
  left join lateral (select a.id, a.state from jobs.attempts a where a.job_id=x.job_id and a.account_id=x.account_id order by a.number desc limit 1) j on true
  where x.account_id=p_account_id and x.project_id=p_project_id and x.job_id=p_job_id and x.category=p_category and x.provider=p_provider
    and x.revoked_at is null and x.expires_at>clock_timestamp() and x.granted_at<=clock_timestamp()
    and exists (select 1 from projects.projects pr where pr.id=x.project_id and pr.account_id=x.account_id and pr.deleted_at is null)
  order by x.granted_at desc limit 1
$$;
revoke all on function api.get_provider_permission(uuid,uuid,uuid,text,text) from public, anon, authenticated;
grant execute on function api.get_provider_permission(uuid,uuid,uuid,text,text) to service_role;

-- The reservation ----------------------------------------------------------------------------------------------------------------------------------

-- The generic form: a permissioned provider (named by the request or by its rate schedule) never reserves here, whatever its case or padding.
create or replace function api.reserve_cost(
  p_account_id uuid, p_epoch bigint, p_command_id uuid, p_operation_id uuid, p_rate_schedule_id uuid,
  p_provider text, p_model text, p_api_version text, p_request_bytes bigint, p_image_count integer,
  p_output_limit integer, p_options jsonb default '{}'::jsonb
) returns api.cost_reservation language plpgsql security definer set search_path = '' as $$
begin
  if provider_private.is_permissioned_provider(p_provider)
     or exists (select 1 from usage.rate_schedules rs where rs.id = p_rate_schedule_id and provider_private.is_permissioned_provider(rs.provider)) then
    return provider_private.refusal('permission_required');
  end if;
  return provider_private.reserve_cost_unchecked(p_account_id,p_epoch,p_command_id,p_operation_id,p_rate_schedule_id,p_provider,p_model,p_api_version,
    p_request_bytes,p_image_count,p_output_limit,p_options);
end $$;
revoke all on function api.reserve_cost(uuid,bigint,uuid,uuid,uuid,text,text,text,bigint,integer,integer,jsonb) from public, anon, authenticated;
grant execute on function api.reserve_cost(uuid,bigint,uuid,uuid,uuid,text,text,text,bigint,integer,integer,jsonb) to service_role;

-- The permissioned form.
create or replace function api.reserve_cost(
  p_account_id uuid, p_epoch bigint, p_command_id uuid, p_operation_id uuid, p_rate_schedule_id uuid,
  p_provider text, p_model text, p_api_version text, p_request_bytes bigint, p_image_count integer,
  p_output_limit integer, p_options jsonb, p_permission_id uuid, p_project_id uuid, p_job_id uuid,
  p_category text, p_purpose text, p_outbound_data text[]
) returns api.cost_reservation
language plpgsql security definer set search_path = '' as $$
declare
  v_operation_job_id uuid;
  v_operation_project_id uuid;
  v_attempt_id uuid;
  v_attempt_state text;
  v_permission provider_private.permissions;
  v_quote record;
begin
  -- 1. The authority (this takes the Account's row FOR SHARE), before any grant is read.
  begin
    perform identity.assert_operation_authority(p_account_id, p_epoch);
  exception when sqlstate 'N3010' then
    return provider_private.refusal('denied');
  end;

  -- 2. Every grant argument, and the operation bound to the Job and Project that own it.
  if p_permission_id is null or p_project_id is null or p_job_id is null or p_operation_id is null
     or p_category is null or p_category not in ('research_search','synthesis_vision') or p_purpose is null or p_outbound_data is null then
    return provider_private.refusal('permission_required');
  end if;
  select a.job_id, j.project_id into v_operation_job_id, v_operation_project_id
    from jobs.operations o
    join jobs.steps s on s.id = o.step_id and s.account_id = o.account_id
    join jobs.attempts a on a.id = s.attempt_id and a.account_id = s.account_id
    join jobs.jobs j on j.id = a.job_id and j.account_id = a.account_id
   where o.id = p_operation_id and o.account_id = p_account_id;
  if not found or v_operation_job_id <> p_job_id or v_operation_project_id <> p_project_id then
    return provider_private.refusal('permission_required');
  end if;

  -- 3. One command at a time for the Job (the lock of every Job command and of the grant).
  perform pg_advisory_xact_lock(hashtextextended('nova3d:job:' || v_operation_job_id::text, 0));

  -- 4. The replay: what this command ID made, or what the operation already holds, is answered whatever has become of the grant.
  if exists (select 1 from usage.commands c where c.account_id = p_account_id and c.command_id = p_command_id)
     or exists (select 1 from usage.reservations r where r.account_id = p_account_id and r.operation_id = p_operation_id) then
    return provider_private.reserve_cost_unchecked(p_account_id,p_epoch,p_command_id,p_operation_id,p_rate_schedule_id,p_provider,p_model,p_api_version,
      p_request_bytes,p_image_count,p_output_limit,p_options);
  end if;

  -- 5. The live grant: the Job's highest Attempt, not finished, is the one the grant was made under.
  select a.id, a.state into v_attempt_id, v_attempt_state
    from jobs.attempts a where a.job_id = v_operation_job_id and a.account_id = p_account_id order by a.number desc limit 1;
  if not found or v_attempt_state in ('completed','failed','cancelled') then
    return provider_private.refusal('permission_required');
  end if;
  select * into v_permission from provider_private.permissions p
    where p.id = p_permission_id and p.account_id = p_account_id and p.project_id = p_project_id and p.job_id = v_operation_job_id
      and p.attempt_id = v_attempt_id
      and p.category = p_category and p.provider = p_provider and p.purpose = p_purpose
      and p.outbound_data @> p_outbound_data and p.outbound_data <@ p_outbound_data
      and p.revoked_at is null and p.granted_at <= clock_timestamp() and p.expires_at > clock_timestamp()
      and exists (select 1 from projects.projects pr where pr.id = p.project_id and pr.account_id = p.account_id and pr.deleted_at is null)
    for update;
  if not found then
    return provider_private.refusal('permission_required');
  end if;

  -- 6. The disclosed maximum bounds the price of ONE request. Only a price can exceed it: any other quote (unavailable_bound, ...) is refused, truthfully, by the reservation below.
  select * into v_quote from api.quote_cost(p_account_id,p_epoch,p_rate_schedule_id,p_provider,p_model,p_api_version,p_request_bytes,p_image_count,p_output_limit,1,p_options);
  if v_quote.outcome = 'quoted' and v_quote.microdollars > v_permission.disclosed_maximum_microdollars then
    return provider_private.refusal('maximum_exceeded');
  end if;

  -- 7. The reservation (the Account's allowance, the Job's cap and the operation cap), in this transaction and under these locks.
  return provider_private.reserve_cost_unchecked(p_account_id,p_epoch,p_command_id,p_operation_id,p_rate_schedule_id,p_provider,p_model,p_api_version,
    p_request_bytes,p_image_count,p_output_limit,p_options);
end $$;
revoke all on function api.reserve_cost(uuid,bigint,uuid,uuid,uuid,text,text,text,bigint,integer,integer,jsonb,uuid,uuid,uuid,text,text,text[]) from public, anon, authenticated;
grant execute on function api.reserve_cost(uuid,bigint,uuid,uuid,uuid,text,text,text,bigint,integer,integer,jsonb,uuid,uuid,uuid,text,text,text[]) to service_role;

comment on function api.reserve_cost(uuid,bigint,uuid,uuid,uuid,text,text,text,bigint,integer,integer,jsonb,uuid,uuid,uuid,text,text,text[]) is
  'Reserves the enforceable maximum cost of ONE external operation of a permissioned provider (Anthropic, Brave) under a live grant. In this order: denied (the Account''s authority); permission_required (a grant argument is missing, or the operation is not the supplied Job''s and Project''s); the replay (replayed | reused | already_reserved, before the grant is read); permission_required (no live grant: revoked, expired, another scope, purpose or outbound data, an Attempt that is no longer the Job''s highest or is finished, a deleted Project); maximum_exceeded (a quoted price above the disclosed maximum); then every outcome of the unchecked reservation. Takes the Job lock.';

-- The preflight -----------------------------------------------------------------------------------------------------------------------------------

-- Everything api.preflight read when 20261024120000_usage_reservations.sql re-created it, plus what Story 2.5 depends on: the provider permissions table (with the Attempt it
-- is bound to), the four new `api` functions (fifty-four in all, each executable by the service role: the grant, the read, the revoke and the permissioned reserve_cost) and the
-- internal functions behind them (the unchecked reservation, the revoke, the vocabulary check, the refusal, the provider gate and the three trigger functions). It checks the
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
  perform u.id, u.account_id, u.seq, u.month_start, u.limit_microdollars, u.carried_settled_microdollars, u.carried_reserved_microdollars, u.cause, u.previous_limit_microdollars, u.actor, u.command_id, u.digest, u.created_at from usage.periods u limit 1;
  perform jb.id, jb.account_id, jb.project_id, jb.kind, jb.created_at from jobs.jobs jb limit 1;
  perform at.id, at.account_id, at.job_id, at.number, at.previous_attempt_id, at.input_digest, at.state, at.stage, at.reason, at.created_at, at.started_at, at.ended_at from jobs.attempts at limit 1;
  perform sp.id, sp.account_id, sp.attempt_id, sp.step_key, sp.created_at from jobs.steps sp limit 1;
  perform op.id, op.account_id, op.step_id, op.ordinal, op.state, op.request_id, op.created_at, op.dispatched_at, op.outcome_at from jobs.operations op limit 1;
  perform cm.account_id, cm.command_id, cm.kind, cm.digest, cm.subject_id, cm.created_at from jobs.commands cm limit 1;
  perform rs.id, rs.provider, rs.model, rs.version, rs.api_version, rs.currency, rs.input_rate_num, rs.input_rate_den, rs.output_rate_num, rs.output_rate_den, rs.request_rate_num, rs.request_rate_den, rs.input_increment, rs.output_increment, rs.multiplier_num, rs.multiplier_den, rs.created_at from usage.rate_schedules rs limit 1;
  perform rv.id, rv.account_id, rv.period_id, rv.job_id, rv.operation_id, rv.rate_schedule_id, rv.provider, rv.requested_model, rv.api_version, rv.request_bytes, rv.image_count, rv.output_limit, rv.input_bound, rv.reserved_microdollars, rv.digest, rv.created_at from usage.reservations rv limit 1;
  perform st.id, st.account_id, st.reservation_id, st.period_id, st.classification, st.settled_microdollars, st.released_microdollars, st.input_tokens, st.output_tokens, st.returned_model, st.digest, st.created_at from usage.settlements st limit 1;
  perform oi.id, oi.account_id, oi.reservation_id, oi.settlement_id, oi.provider, oi.reserved_microdollars, oi.evidence_microdollars, oi.created_at, oi.cleared_at, oi.cleared_by from usage.overrun_incidents oi limit 1;
  perform uc.account_id, uc.command_id, uc.kind, uc.digest, uc.subject_id, uc.created_at from usage.commands uc limit 1;
  perform pp.id, pp.account_id, pp.project_id, pp.job_id, pp.attempt_id, pp.category, pp.provider, pp.purpose, pp.outbound_data, pp.disclosed_maximum_microdollars, pp.granted_at, pp.expires_at, pp.revoked_at from provider_private.permissions pp limit 1;
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
      'api.set_usage_limit(text,uuid,bigint,uuid,uuid,text,bigint,integer)',
      'api.list_usage(uuid,bigint)',
      'api.record_usage_refusal(uuid,text,uuid)',
      'usage.ensure_period(uuid)',
      'usage.period_figures(uuid)',
      'usage.available_microdollars(uuid)',
      'usage.default_limit(text)'
    ]) as f(signature)
   where to_regprocedure(f.signature) is null;
  if v_missing is not null then
    raise exception 'api.preflight: the Story 2.4 migration is not applied (missing %)', v_missing using errcode = 'N3020';
  end if;

  select string_agg(f.signature, ', ') into v_missing
    from unnest(array[
      'api.accept_job(uuid,bigint,uuid,uuid,text,text)',
      'api.begin_step(uuid,bigint,uuid,uuid,text,integer)',
      'api.advance_operation(uuid,bigint,uuid,uuid,text,text)',
      'api.move_attempt(uuid,bigint,uuid,uuid,text,text)',
      'api.request_retry(uuid,bigint,uuid,uuid,integer,text)',
      'api.read_job(uuid,bigint,uuid)'
    ]) as f(signature)
   where to_regprocedure(f.signature) is null;
  if v_missing is not null then
    raise exception 'api.preflight: the Story 2.11 migration is not applied (missing %)', v_missing using errcode = 'N3020';
  end if;

  select string_agg(f.signature, ', ') into v_missing
    from unnest(array[
      'api.quote_cost(uuid,bigint,uuid,text,text,text,bigint,integer,integer,integer,jsonb)',
      'api.reserve_cost(uuid,bigint,uuid,uuid,uuid,text,text,text,bigint,integer,integer,jsonb)',
      'api.settle_cost(uuid,uuid,uuid,text,bigint,bigint,text)',
      'usage.input_bound(bigint,integer)',
      'usage.price(uuid,numeric,numeric,integer)',
      'usage.job_exposure(uuid)',
      'usage.overhead_tokens()',
      'usage.image_tokens()',
      'usage.margin_percent()',
      'usage.input_ceiling()',
      'usage.output_ceiling()',
      'usage.request_ceiling()',
      'usage.operation_cap()',
      'usage.job_cap()',
      'usage.ambiguity_deadline()'
    ]) as f(signature)
   where to_regprocedure(f.signature) is null;
  if v_missing is not null then
    raise exception 'api.preflight: the Story 2.6 migration is not applied (missing %)', v_missing using errcode = 'N3020';
  end if;

  select string_agg(f.signature, ', ') into v_missing
    from unnest(array[
      'api.grant_provider_permission(uuid,uuid,uuid,text,text,text,text[],bigint)',
      'api.get_provider_permission(uuid,uuid,uuid,text,text)',
      'api.revoke_provider_permission(uuid,uuid,uuid,uuid)',
      'api.reserve_cost(uuid,bigint,uuid,uuid,uuid,text,text,text,bigint,integer,integer,jsonb,uuid,uuid,uuid,text,text,text[])',
      'provider_private.reserve_cost_unchecked(uuid,bigint,uuid,uuid,uuid,text,text,text,bigint,integer,integer,jsonb)',
      'provider_private.revoke_permission(uuid,uuid,uuid,uuid)',
      'provider_private.valid_outbound(text[])',
      'provider_private.refusal(text)',
      'provider_private.is_permissioned_provider(text)',
      'provider_private.stamp_permission()',
      'provider_private.supersede_permission()',
      'provider_private.guard_permission_change()'
    ]) as f(signature)
   where to_regprocedure(f.signature) is null;
  if v_missing is not null then
    raise exception 'api.preflight: the Story 2.5 migration is not applied (missing %)', v_missing using errcode = 'N3020';
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
      'api.read_retained_pictures(uuid,bigint,uuid)',
      'api.set_usage_limit(text,uuid,bigint,uuid,uuid,text,bigint,integer)',
      'api.list_usage(uuid,bigint)',
      'api.record_usage_refusal(uuid,text,uuid)',
      'api.accept_job(uuid,bigint,uuid,uuid,text,text)',
      'api.begin_step(uuid,bigint,uuid,uuid,text,integer)',
      'api.advance_operation(uuid,bigint,uuid,uuid,text,text)',
      'api.move_attempt(uuid,bigint,uuid,uuid,text,text)',
      'api.request_retry(uuid,bigint,uuid,uuid,integer,text)',
      'api.read_job(uuid,bigint,uuid)',
      'api.quote_cost(uuid,bigint,uuid,text,text,text,bigint,integer,integer,integer,jsonb)',
      'api.reserve_cost(uuid,bigint,uuid,uuid,uuid,text,text,text,bigint,integer,integer,jsonb)',
      'api.settle_cost(uuid,uuid,uuid,text,bigint,bigint,text)',
      'api.grant_provider_permission(uuid,uuid,uuid,text,text,text,text[],bigint)',
      'api.get_provider_permission(uuid,uuid,uuid,text,text)',
      'api.revoke_provider_permission(uuid,uuid,uuid,uuid)',
      'api.reserve_cost(uuid,bigint,uuid,uuid,uuid,text,text,text,bigint,integer,integer,jsonb,uuid,uuid,uuid,text,text,text[])'
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
  'Reads identity.session_grants (including its CSRF columns), identity.accounts (including its status handle), identity.account_preferences, identity.step_up_nonces, identity.fresh_authentications (including source), identity.recovery_tokens, projects.projects, projects.project_commands, projects.request_revisions (including the review columns), projects.request_images (including the labels and measurements and the retained pins), lifecycle.tombstones, lifecycle.ledger_outbox, lifecycle.ledger_relay, lifecycle.status_requests, lifecycle.job_receipts, the six artifacts tables and the artifacts.session_authority, artifacts.instance and artifacts.retained_pictures views, lifecycle.alarms, lifecycle.alarm_notices, lifecycle.heartbeats, usage.periods, jobs.jobs, jobs.attempts, jobs.steps, jobs.operations, jobs.commands, usage.rate_schedules, usage.reservations, usage.settlements, usage.overrun_incidents, usage.commands, provider_private.permissions, auth.sessions, auth.identities and auth.mfa_amr_claims (one row each at most), checks that the Story 1.5, 1.6, 1.7, 1.8, 1.9, 1.12, 1.13, 2.1, 2.2, 2.3, 2.12, 2.4, 2.11, 2.6 and 2.5 functions exist and are executable by the service role, that the private-files bucket exists and is private, and that the owner may delete from auth.sessions and auth.users, and answers ok. Read-only.';

-- New functions: have the Data API reload its schema cache now.
notify pgrst, 'reload schema';
