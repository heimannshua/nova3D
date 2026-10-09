-- Story 1.1: the Lifecycle-owned identity of this environment (AR-26).
-- One row per database. APP_ENV and INSTANCE_ID mirror it and are verified at startup, in
-- `check-env --live` and in the deployment build. This is the only table the story adds.
-- Hosted environments insert their row once at provisioning; local gets it from seed.sql.

create schema if not exists lifecycle;

create table lifecycle.instance_identity (
  id boolean primary key default true check (id),
  environment text not null check (environment in ('local', 'staging', 'production')),
  instance_id uuid not null default gen_random_uuid(),
  created_at timestamptz not null default now()
);

comment on table lifecycle.instance_identity is
  'Single-row identity of this environment. Mirrored by APP_ENV and INSTANCE_ID; never written by the application.';

alter table lifecycle.instance_identity enable row level security;

-- No policies: only roles that bypass RLS (service_role) can read the row.
revoke all on schema lifecycle from public, anon, authenticated;
revoke all on table lifecycle.instance_identity from public, anon, authenticated;

-- The server reads the row with the service role. It never writes it.
grant usage on schema lifecycle to service_role;
grant select on lifecycle.instance_identity to service_role;
