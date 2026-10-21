-- Additive Story 2.5 admission overload. The existing Story 2.6 contract remains
-- available for its non-provider ledger tests; production provider work must call
-- this overload so the grant is checked under the same transaction/locks.
create or replace function api.reserve_cost(
  p_account_id uuid, p_epoch bigint, p_command_id uuid, p_operation_id uuid, p_rate_schedule_id uuid,
  p_provider text, p_model text, p_api_version text, p_request_bytes bigint, p_image_count integer,
  p_output_limit integer, p_options jsonb, p_permission_id uuid, p_project_id uuid, p_job_id uuid,
  p_category text, p_purpose text, p_outbound_data text[]
) returns api.cost_reservation
language plpgsql security definer set search_path = '' as $$
declare v_permission provider_private.permissions;
declare v_quote record;
begin
  if p_permission_id is null or p_project_id is null or p_job_id is null or p_category not in ('research_search','synthesis_vision')
    or p_purpose is null or p_outbound_data is null then
    return row('permission_required',null::uuid,null::uuid,null::uuid,null::uuid,null::uuid,null::bigint,null::bigint,null::text,null::text,null::text,null::bigint,null::bigint,null::bigint,null::bigint)::api.cost_reservation;
  end if;
  select * into v_permission from provider_private.permissions p
    where p.id=p_permission_id and p.account_id=p_account_id and p.project_id=p_project_id and p.job_id=p_job_id
      and p.category=p_category and p.provider=p_provider and p.purpose=p_purpose and p.outbound_data=p_outbound_data
      and p.revoked_at is null and p.expires_at > clock_timestamp()
      and p.granted_at <= clock_timestamp() and p.expires_at <= p.granted_at + interval '7 days'
      and exists (select 1 from lateral (select a.state from jobs.attempts a where a.job_id=p.job_id and a.account_id=p.account_id order by a.number desc limit 1) latest
                  where latest.state not in ('completed','failed','cancelled'))
    for update;
  if not found then
    return row('permission_required',null::uuid,null::uuid,null::uuid,null::uuid,null::uuid,null::bigint,null::bigint,null::text,null::text,null::text,null::bigint,null::bigint,null::bigint,null::bigint)::api.cost_reservation;
  end if;
  -- The existing calculator and reservation then run in this same transaction. Its admission ceiling is also
  -- checked against the disclosed maximum before any receipt is returned.
  select * into v_quote from api.quote_cost(p_account_id,p_epoch,p_rate_schedule_id,p_provider,p_model,p_api_version,p_request_bytes,p_image_count,p_output_limit,1,p_options);
  if v_quote.outcome <> 'quoted' or v_quote.microdollars > v_permission.disclosed_maximum_microdollars then
    return row('maximum_exceeded',null::uuid,null::uuid,null::uuid,null::uuid,null::uuid,null::bigint,null::bigint,null::text,null::text,null::text,null::bigint,null::bigint,null::bigint,null::bigint)::api.cost_reservation;
  end if;
  return api.reserve_cost(p_account_id,p_epoch,p_command_id,p_operation_id,p_rate_schedule_id,p_provider,p_model,p_api_version,
    p_request_bytes,p_image_count,p_output_limit,p_options);
end $$;
revoke all on function api.reserve_cost(uuid,bigint,uuid,uuid,uuid,text,text,text,bigint,integer,integer,jsonb,uuid,uuid,uuid,text,text,text[]) from public,anon,authenticated;
grant execute on function api.reserve_cost(uuid,bigint,uuid,uuid,uuid,text,text,text,bigint,integer,integer,jsonb,uuid,uuid,uuid,text,text,text[]) to service_role;
notify pgrst,'reload schema';
