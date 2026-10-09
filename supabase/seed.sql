-- Local development only. Hosted environments are not seeded; they insert their own row once
-- at provisioning (docs/deployment-setup.md).
insert into lifecycle.instance_identity (environment) values ('local') on conflict do nothing;
