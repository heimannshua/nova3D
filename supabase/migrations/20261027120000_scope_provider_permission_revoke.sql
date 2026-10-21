drop function api.revoke_provider_permission(uuid,uuid);
drop function provider_private.revoke_permission(uuid,uuid);

create function provider_private.revoke_permission(p_account_id uuid, p_project_id uuid, p_job_id uuid, p_permission_id uuid)
returns boolean language sql security definer set search_path = '' as $$
  update provider_private.permissions set revoked_at = coalesce(revoked_at, clock_timestamp())
  where account_id=p_account_id and project_id=p_project_id and job_id=p_job_id and id=p_permission_id and revoked_at is null
  returning true
$$;
revoke all on function provider_private.revoke_permission(uuid,uuid,uuid,uuid) from public,anon,authenticated;
grant execute on function provider_private.revoke_permission(uuid,uuid,uuid,uuid) to service_role;

create function api.revoke_provider_permission(p_account_id uuid, p_project_id uuid, p_job_id uuid, p_permission_id uuid)
returns jsonb language sql security definer set search_path = '' as $$
  select jsonb_build_object('revoked',coalesce(provider_private.revoke_permission(p_account_id,p_project_id,p_job_id,p_permission_id),false))
$$;
revoke all on function api.revoke_provider_permission(uuid,uuid,uuid,uuid) from public,anon,authenticated;
grant execute on function api.revoke_provider_permission(uuid,uuid,uuid,uuid) to service_role;
notify pgrst,'reload schema';
