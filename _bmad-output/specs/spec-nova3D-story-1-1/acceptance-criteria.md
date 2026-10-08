# Acceptance Criteria

**Story 1.1: Adopt and harden the qualified application seed**

**Epic 1: Enter and use a private workspace.** Invited users can authenticate and use a responsive private workspace; Josh can control and recover access without inspecting private content.

As a maintainer,
I want a reproducible application startup,
So that implementation starts from the qualified runtime.

**Requirement IDs:** AR-1, AR-2, AR-26, NFR-2

## Dependencies

None.

## Scope

- Adopt the existing root Next.js App Router application (Next 16.3.5, React 19.3.0, TypeScript 5.9.3, Tailwind 4.3.3, Supabase SSR, interim Google sign-in) as the qualified seed and bring it to the pinned contract.
- Verify the environment at startup and in the deployment build, and exercise the check in CI. Label the mock dashboard a synthetic shell that later stories replace.
- Define module ownership and environment boundaries; later stories introduce their own entities.
- Run local development on the Supabase CLI stack, not the hosted project: add the `[auth]` block (Google only, sign-ups on, redirect URLs, OTP expiry) and `[auth.external.google]` to `supabase/config.toml`, re-point `.env.local`, and make `APP_ENV=local` valid only against a loopback Supabase URL. The existing hosted project becomes staging (Story 1.10 records its plan and region), Vercel Production deploys stay disabled until a production project exists, and the environment check requires an Administrator email setting (`ADMINISTRATOR_EMAIL`). Create the Lifecycle `instance_identity` row (environment name and a random instance UUID) with its migration, the only table this story adds, and make `APP_ENV` and `INSTANCE_ID` mirror it.
- Keep `scripts/restore-supabase.mjs` while `scripts/ci/check-repository.mjs` requires it, and change both together. Set `engines` to Node 24 with CI pinning 24.21.0 (Vercel supplies its own Node 24 patch). Replace the LAN-origin redirect instructions in `docs/auth-setup.md` with the local-stack callback of this story.
- Replace the guard in `scripts/check-env.mjs` that rejects `VERCEL_ENV=production` unless `APP_ENV=production` with a comparison against the `instance_identity` row, so the staging Vercel project (whose production branch is `staging`) is valid. Change `vercel.json` so only the `staging` branch deploys to that project, with `main` promoted to `staging` by fast-forward, and give preview deployments no Supabase credentials.
- Choose and pin the test runners: a unit and integration runner that runs Postgres tests against the Supabase CLI stack, and Playwright for browser flows, with local stand-ins for mail (Inbucket) and for QStash, Backblaze, Resend and the Railway workers that implement the same ports.

## Acceptance Criteria

### AC-1

**Given** a clean checkout and the ratified package set
**When** dependencies install, typechecking and production build run
**Then** the lockfile records the adopted versions, `engines` allows Node 24 (Vercel supplies the patch release) and CI pins 24.21.0, build-only tooling is not a runtime dependency, the bundler choice is recorded with its qualification evidence, and a loopback production page responds successfully; CI runs the unit, integration and browser suites against the local stack

### AC-2

**Given** a preview environment
**When** configuration is loaded
**Then** production credentials and paid adapters are unavailable, and a mixed or unverifiable environment identifier fails startup and the deployment build. The check compares the `instance_identity` row's environment name and UUID with `APP_ENV`, `INSTANCE_ID`, the configured queue prefix and the allowed callback origin, not only the label, and CI exercises it against fixture environments. A credential-free local build still succeeds; preview builds hold no Supabase credentials

### AC-3

**Given** the adopted shell
**When** its routes, data and modules are reviewed
**Then** it contains only startup needs and a clearly labeled synthetic dashboard, with no persisted-data claim, no future domain tables beyond `instance_identity`, and no claim that deployed providers are qualified

## Engineering Gates

This story has no separate gate ID; applicable project-wide gates still govern acceptance.

These are acceptance obligations, not claims that the implementation or qualification has passed.
