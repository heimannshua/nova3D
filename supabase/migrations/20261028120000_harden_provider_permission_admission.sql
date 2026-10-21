-- Story 2.5 hardening: validate persisted grants, serialize replacements, and
-- serialize admission with Job state transitions (Story 2.11's Job lock).
create function provider_private.valid_outbound(p_data text[]) returns boolean
language sql immutable set search_path = '' as $$
  select p_data <@ array['normalized_public_subject','confirmed_project_scope','project_evidence','provider_image_derivatives']::text[]
    and cardinality(p_data)=(select count(distinct d) from unnest(p_data) d)
$$;
revoke all on function provider_private.valid_outbound(text[]) from public,anon,authenticated,service_role;

alter table provider_private.permissions
  add constraint provider_permissions_category_data check (
    (category='research_search' and provider='brave' and outbound_data=array['normalized_public_subject'])
    or (category='synthesis_vision' and provider='anthropic' and not ('normalized_public_subject'=any(outbound_data)))
  ),
  add constraint provider_permissions_data_vocabulary check (provider_private.valid_outbound(outbound_data));

create function provider_private.supersede_permission() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  perform pg_advisory_xact_lock(hashtextextended('nova3d:provider-permission:' || new.account_id::text || ':' || new.job_id::text || ':' || new.category || ':' || new.provider, 0));
  update provider_private.permissions set revoked_at=clock_timestamp()
    where account_id=new.account_id and project_id=new.project_id and job_id=new.job_id and category=new.category and provider=new.provider and revoked_at is null;
  return new;
end $$;
revoke all on function provider_private.supersede_permission() from public,anon,authenticated,service_role;
create trigger provider_permissions_supersede before insert on provider_private.permissions
  for each row execute function provider_private.supersede_permission();

create or replace function api.get_provider_permission(p_account_id uuid, p_project_id uuid, p_job_id uuid, p_category text, p_provider text)
returns setof jsonb language sql security definer set search_path = '' as $$
  select jsonb_build_object('id',x.id,'account_id',x.account_id,'project_id',x.project_id,'job_id',x.job_id,'category',x.category,'provider',x.provider,
    'purpose',x.purpose,'outbound_data',x.outbound_data,'disclosed_maximum_microdollars',x.disclosed_maximum_microdollars,'granted_at',x.granted_at,
    'expires_at',x.expires_at,'revoked_at',x.revoked_at,'job_terminal',coalesce(j.state in ('completed','failed','cancelled'),true))
  from provider_private.permissions x left join lateral (select a.state from jobs.attempts a where a.job_id=x.job_id and a.account_id=x.account_id order by a.number desc limit 1) j on true
  where x.account_id=p_account_id and x.project_id=p_project_id and x.job_id=p_job_id and x.category=p_category and x.provider=p_provider
    and x.revoked_at is null and x.expires_at>clock_timestamp() and x.granted_at<=clock_timestamp()
  order by x.granted_at desc limit 1
$$;
revoke all on function api.get_provider_permission(uuid,uuid,uuid,text,text) from public,anon,authenticated;
grant execute on function api.get_provider_permission(uuid,uuid,uuid,text,text) to service_role;

create or replace function api.reserve_cost(
  p_account_id uuid, p_epoch bigint, p_command_id uuid, p_operation_id uuid, p_rate_schedule_id uuid,
  p_provider text, p_model text, p_api_version text, p_request_bytes bigint, p_image_count integer,
  p_output_limit integer, p_options jsonb, p_permission_id uuid, p_project_id uuid, p_job_id uuid,
  p_category text, p_purpose text, p_outbound_data text[]
) returns api.cost_reservation
language plpgsql security definer set search_path = '' as $$
declare v_permission provider_private.permissions; v_quote record;
begin
  if p_permission_id is null or p_project_id is null or p_job_id is null or p_category not in ('research_search','synthesis_vision')
    or p_purpose is null or p_outbound_data is null then
    return row('permission_required',null::uuid,null::uuid,null::uuid,null::uuid,null::uuid,null::bigint,null::bigint,null::text,null::text,null::text,null::bigint,null::bigint,null::bigint,null::bigint)::api.cost_reservation;
  end if;
  perform pg_advisory_xact_lock(hashtextextended('nova3d:job:' || p_job_id::text, 0));
  select * into v_permission from provider_private.permissions p
    where p.id=p_permission_id and p.account_id=p_account_id and p.project_id=p_project_id and p.job_id=p_job_id
      and p.category=p_category and p.provider=p_provider and p.purpose=p_purpose and p.outbound_data=p_outbound_data
      and p.revoked_at is null and p.expires_at>clock_timestamp() and p.granted_at<=clock_timestamp()
      and p.expires_at<=p.granted_at+interval '7 days'
      and exists (select 1 from lateral (select a.state from jobs.attempts a where a.job_id=p.job_id and a.account_id=p.account_id order by a.number desc limit 1) latest
                  where latest.state not in ('completed','failed','cancelled'))
    for update;
  if not found then
    return row('permission_required',null::uuid,null::uuid,null::uuid,null::uuid,null::uuid,null::bigint,null::bigint,null::text,null::text,null::text,null::bigint,null::bigint,null::bigint,null::bigint)::api.cost_reservation;
  end if;
  select * into v_quote from api.quote_cost(p_account_id,p_epoch,p_rate_schedule_id,p_provider,p_model,p_api_version,p_request_bytes,p_image_count,p_output_limit,1,p_options);
  if v_quote.outcome<>'quoted' or v_quote.microdollars>v_permission.disclosed_maximum_microdollars then
    return row('maximum_exceeded',null::uuid,null::uuid,null::uuid,null::uuid,null::uuid,null::bigint,null::bigint,null::text,null::text,null::text,null::bigint,null::bigint,null::bigint,null::bigint)::api.cost_reservation;
  end if;
  return api.reserve_cost(p_account_id,p_epoch,p_command_id,p_operation_id,p_rate_schedule_id,p_provider,p_model,p_api_version,
    p_request_bytes,p_image_count,p_output_limit,p_options);
end $$;
revoke all on function api.reserve_cost(uuid,bigint,uuid,uuid,uuid,text,text,text,bigint,integer,integer,jsonb,uuid,uuid,uuid,text,text,text[]) from public,anon,authenticated;
grant execute on function api.reserve_cost(uuid,bigint,uuid,uuid,uuid,text,text,text,bigint,integer,integer,jsonb,uuid,uuid,uuid,text,text,text[]) to service_role;
notify pgrst,'reload schema';
