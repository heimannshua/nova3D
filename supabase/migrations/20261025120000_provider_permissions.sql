-- Story 2.5: category-scoped provider permissions. These grants remain inert until
-- a Job admission path supplies and checks them alongside its reservation.
create schema if not exists provider_private;
revoke all on schema provider_private from public, anon, authenticated;

grant usage on schema provider_private to service_role;

create table provider_private.permissions (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null,
  project_id uuid not null,
  job_id uuid not null,
  category text not null check (category in ('research_search', 'synthesis_vision')),
  provider text not null check (provider in ('anthropic', 'brave')),
  purpose text not null check (length(purpose) between 1 and 500),
  outbound_data text[] not null check (cardinality(outbound_data) between 1 and 8),
  disclosed_maximum_microdollars bigint not null check (disclosed_maximum_microdollars between 1 and 1000000),
  granted_at timestamptz not null default clock_timestamp(),
  expires_at timestamptz not null default (clock_timestamp() + interval '7 days'),
  revoked_at timestamptz,
  constraint provider_permissions_expiry check (expires_at <= granted_at + interval '7 days')
);
create index provider_permissions_job_idx on provider_private.permissions(account_id, project_id, job_id, category, provider);
alter table provider_private.permissions enable row level security;
revoke all on provider_private.permissions from public, anon, authenticated;
grant select, insert, update on provider_private.permissions to service_role;

create function api.grant_provider_permission(p_account_id uuid, p_project_id uuid, p_job_id uuid, p_category text, p_provider text,
  p_purpose text, p_outbound_data text[], p_disclosed_maximum_microdollars bigint)
returns setof jsonb language plpgsql security definer set search_path = '' as $$
declare v_id uuid;
begin
  if p_account_id is null or p_project_id is null or p_job_id is null or p_category not in ('research_search','synthesis_vision')
    or p_provider not in ('anthropic','brave') or p_purpose is null or length(p_purpose) not between 1 and 500
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
  if not exists (select 1 from projects.projects p where p.id=p_project_id and p.account_id=p_account_id and p.deleted_at is null)
     or not exists (select 1 from jobs.jobs j where j.id=p_job_id and j.account_id=p_account_id and j.project_id=p_project_id) then
    return;
  end if;
  if exists (select 1 from lateral (select a.state from jobs.attempts a where a.job_id=p_job_id and a.account_id=p_account_id order by a.number desc limit 1) latest
             where latest.state in ('completed','failed','cancelled')) then
    return;
  end if;
  insert into provider_private.permissions(account_id,project_id,job_id,category,provider,purpose,outbound_data,disclosed_maximum_microdollars)
    values(p_account_id,p_project_id,p_job_id,p_category,p_provider,p_purpose,p_outbound_data,p_disclosed_maximum_microdollars) returning id into v_id;
  return query select jsonb_build_object('id',x.id,'account_id',x.account_id,'project_id',x.project_id,'job_id',x.job_id,'category',x.category,
    'provider',x.provider,'purpose',x.purpose,'outbound_data',x.outbound_data,'disclosed_maximum_microdollars',x.disclosed_maximum_microdollars,
    'granted_at',x.granted_at,'expires_at',x.expires_at,'revoked_at',x.revoked_at,'job_terminal',false)
    from provider_private.permissions x where x.id=v_id;
end $$;

create function api.get_provider_permission(p_account_id uuid, p_project_id uuid, p_job_id uuid, p_category text, p_provider text)
returns setof jsonb language sql security definer set search_path = '' as $$
  select jsonb_build_object('id',x.id,'account_id',x.account_id,'project_id',x.project_id,'job_id',x.job_id,'category',x.category,'provider',x.provider,
    'purpose',x.purpose,'outbound_data',x.outbound_data,'disclosed_maximum_microdollars',x.disclosed_maximum_microdollars,'granted_at',x.granted_at,
    'expires_at',x.expires_at,'revoked_at',x.revoked_at,'job_terminal',coalesce(j.state in ('completed','failed','cancelled'),true))
  from provider_private.permissions x left join lateral (select a.state from jobs.attempts a where a.job_id=x.job_id and a.account_id=x.account_id order by a.number desc limit 1) j on true
  where x.account_id=p_account_id and x.project_id=p_project_id and x.job_id=p_job_id and x.category=p_category and x.provider=p_provider
  order by x.granted_at desc limit 1
$$;

create function provider_private.revoke_permission(p_account_id uuid, p_project_id uuid, p_job_id uuid, p_permission_id uuid)
returns boolean language sql security definer set search_path = '' as $$
  update provider_private.permissions set revoked_at = coalesce(revoked_at, clock_timestamp())
  where account_id = p_account_id and project_id = p_project_id and job_id = p_job_id and id = p_permission_id and revoked_at is null
  returning true
$$;
revoke all on function provider_private.revoke_permission(uuid, uuid, uuid, uuid) from public, anon, authenticated;
grant execute on function provider_private.revoke_permission(uuid, uuid, uuid, uuid) to service_role;

create function api.revoke_provider_permission(p_account_id uuid, p_project_id uuid, p_job_id uuid, p_permission_id uuid)
returns jsonb language sql security definer set search_path = '' as $$
  select jsonb_build_object('revoked', coalesce(provider_private.revoke_permission(p_account_id,p_project_id,p_job_id,p_permission_id),false))
$$;
revoke all on function api.grant_provider_permission(uuid,uuid,uuid,text,text,text,text[],bigint) from public, anon, authenticated;
revoke all on function api.get_provider_permission(uuid,uuid,uuid,text,text) from public, anon, authenticated;
revoke all on function api.revoke_provider_permission(uuid,uuid,uuid,uuid) from public, anon, authenticated;
grant execute on function api.grant_provider_permission(uuid,uuid,uuid,text,text,text,text[],bigint) to service_role;
grant execute on function api.get_provider_permission(uuid,uuid,uuid,text,text) to service_role;
grant execute on function api.revoke_provider_permission(uuid,uuid,uuid,uuid) to service_role;
