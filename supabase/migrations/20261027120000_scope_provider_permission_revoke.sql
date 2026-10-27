-- Story 2.5: revoke only inside the grant's saved scope. 20261025120000 already creates the four-argument functions, so on a fresh database the drops find nothing
-- and the creates replace identical bodies; a database that ran an earlier text of that file still holds the two-argument ones, and they go.
drop function if exists api.revoke_provider_permission(uuid,uuid);
drop function if exists provider_private.revoke_permission(uuid,uuid);

create or replace function provider_private.revoke_permission(p_account_id uuid, p_project_id uuid, p_job_id uuid, p_permission_id uuid)
returns boolean language sql security definer set search_path = '' as $$
  update provider_private.permissions set revoked_at = coalesce(revoked_at, clock_timestamp())
  where account_id=p_account_id and project_id=p_project_id and job_id=p_job_id and id=p_permission_id and revoked_at is null
  returning true
$$;
revoke all on function provider_private.revoke_permission(uuid,uuid,uuid,uuid) from public,anon,authenticated;
grant execute on function provider_private.revoke_permission(uuid,uuid,uuid,uuid) to service_role;

create or replace function api.revoke_provider_permission(p_account_id uuid, p_project_id uuid, p_job_id uuid, p_permission_id uuid)
returns jsonb language sql security definer set search_path = '' as $$
  select jsonb_build_object('revoked',coalesce(provider_private.revoke_permission(p_account_id,p_project_id,p_job_id,p_permission_id),false))
$$;
revoke all on function api.revoke_provider_permission(uuid,uuid,uuid,uuid) from public,anon,authenticated;
grant execute on function api.revoke_provider_permission(uuid,uuid,uuid,uuid) to service_role;
notify pgrst,'reload schema';
