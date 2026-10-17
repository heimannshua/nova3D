-- Local development only. Hosted environments are not seeded; they insert their own row once
-- at provisioning (docs/deployment-setup.md).
insert into lifecycle.instance_identity (environment) values ('local') on conflict do nothing;

-- Story 1.12: the file gateway's database role is created by the migration WITHOUT a password (a password in a migration would be a secret in the
-- repository). The local stack's gateway uses this one, which opens nothing but the local database on loopback. A hosted database's password is set
-- by hand and is held only by the gateway service (docs/staging.md).
alter role nova3d_gateway with password 'nova3d-gateway-local';
