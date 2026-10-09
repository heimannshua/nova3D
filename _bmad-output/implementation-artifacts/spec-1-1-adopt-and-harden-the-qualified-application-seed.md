---
title: 'Story 1.1: Adopt and harden the qualified application seed'
type: 'chore'
created: '2026-10-09'
status: 'done'
baseline_commit: '65ccc5b3c68dde33fd09ee38d0eb57806ca5148f'
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-1-context.md'
  - '{project-root}/_bmad-output/specs/spec-nova3D-story-1-1/acceptance-criteria.md'
  - '{project-root}/_bmad-output/specs/spec-nova3D-story-1-1/implementation-constraints.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** The seed app starts without a verifiable environment identity (`check-env.mjs` checks only the `APP_ENV` label), local development points at the hosted Supabase project, `engines` allows Node 20, CI runs no unit, integration or browser suites, and the mock dashboard is not labelled synthetic.

**Approach:** Bring the seed to the pinned contract: Node 24, a Lifecycle `instance_identity` row mirrored by `APP_ENV` and `INSTANCE_ID` and verified at startup, the Supabase CLI stack for local work with its auth settings declared in `config.toml`, pinned Vitest and Playwright runners, and a synthetic-shell label.

## Boundaries & Constraints

**Always:** Consult `node_modules/next/dist/docs/` before writing Next.js code (AGENTS.md). Commit no secrets. `APP_ENV=local` is valid only against a loopback Supabase URL. `instance_identity` is the only table added. Change `scripts/restore-supabase.mjs` and `scripts/ci/check-repository.mjs` together. Leave `AUTH_ALLOWED_EMAILS` and the interim gate in place (Story 1.3 replaces them). The deployment-build check runs only when `VERCEL` is set, so local and CI builds stay credential-free.

**Ask First:** Any change to Vercel project settings or the `staging` branch itself is Josh's; HALT rather than push `staging` or touch the dashboard. Known and accepted consequence (Josh, 2026-10-09): once `vercel.json` lands, `main` no longer deploys, and the Vercel project fails its build until `INSTANCE_ID` and `ADMINISTRATOR_EMAIL` are set there and the staging database has its identity row.

**Never:** Add any other table, route or feature. Create production resources. Store a Supabase service key in a preview build. Build fakes for ports that no story has defined yet (QStash, Backblaze, Resend, Stripe, workers) or the local Google OIDC stand-in; they move to the stories that create those ports and flows (recorded in `deferred-work.md`).

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Matching identity | `APP_ENV`, `INSTANCE_ID` and Supabase URL agree with the `instance_identity` row | Startup proceeds | N/A |
| Mixed identity | row says staging, `APP_ENV=production`, or UUID differs | Startup and `check-env --live` fail naming the mismatch | Exit 1, no secret printed |
| Local, non-loopback URL | `APP_ENV=local` with a cloud URL | Rejected | Exit 1 |
| Preview build | `VERCEL_ENV=preview` with any Supabase key | Rejected; without keys, label-only checks pass | Exit 1 |
| Credential-free local build | no env at all | `next build` succeeds | N/A |
| Missing admin | no `ADMINISTRATOR_EMAIL` | Rejected | Exit 1 |
| Staging deployment build | `VERCEL` set, `VERCEL_ENV=production`, row matches | Build proceeds | N/A |
| Deployment build, database unreachable or row absent | `VERCEL` set, non-preview | Build fails closed | Exit 1 |

</frozen-after-approval>

## Code Map

- `package.json` -- `engines` is `>=20.12.0`; `bmad-method` is a runtime dependency; scripts lack test runners.
- `.github/workflows/ci.yml` -- `setup-node` uses `24` unpinned; no unit, integration or browser jobs.
- `scripts/check-env.mjs`, `scripts/test-env.mjs` -- label-only checks and their tests; the `VERCEL_ENV=production` rule is replaced by the identity comparison.
- `scripts/setup-env.mjs`, `.env.example`, `.env.staging.example`, `.env.production.example` -- templates; add `ADMINISTRATOR_EMAIL`, `INSTANCE_ID`.
- `supabase/config.toml` -- ports only; needs `[auth]`, `[auth.external.google]`, `[storage]`.
- `supabase/migrations/` -- absent; add the `instance_identity` migration and Postgres tests.
- `lib/auth-config.ts`, `proxy.ts`, `app/auth/callback/route.ts` -- interim allowlist; read-only here.
- `components/nova-dashboard.tsx:69`, `lib/mock-data.ts:47` -- "Mock mode" footnote and `appMode: 'mock'`; make the synthetic-shell label explicit.
- `docs/auth-setup.md`, `docs/deployment-setup.md` -- LAN callback instructions to replace.
- `vercel.json` -- `git.deploymentEnabled.main` is true and only `regions` is set; becomes staging-only.
- `scripts/ci/check-repository.mjs`, `scripts/restore-supabase.mjs` -- the former requires the latter; change together.

## Tasks & Acceptance

**Execution:**
- [x] `package.json`, `package-lock.json` -- set `engines.node` to `>=24 <25`, move `bmad-method` to devDependencies, add pinned `vitest` and `@playwright/test` and the `test` scripts -- AC-1
- [x] `.github/workflows/ci.yml` -- pin Node 24.21.0, start the Supabase CLI stack, run unit, integration and browser suites -- AC-1
- [x] `supabase/config.toml` -- add `[auth]` (Google only, sign-ups on, redirect URLs, OTP expiry, 30-day time-box, 7-day inactivity), `[auth.external.google]`, `[storage] file_size_limit = "100MiB"` -- local stack parity
- [x] `supabase/migrations/<timestamp>_instance_identity.sql` -- single-row `lifecycle.instance_identity` (environment, random instance UUID), RLS on, no `anon`/`authenticated` grants -- AC-2
- [x] `scripts/check-env.mjs` -- require `ADMINISTRATOR_EMAIL` and `INSTANCE_ID`; enforce loopback for local and no Supabase credentials in previews; add `--live` row comparison; wire startup verification through `instrumentation.ts` -- AC-2
- [x] `vercel.json`, `package.json` -- only the `staging` branch deploys (`ignoreCommand` skips other refs, `main` is promoted to `staging` by fast-forward); `prebuild` runs `check-env --deployment`, active only when `VERCEL` is set -- AC-2
- [x] `scripts/test-env.mjs`, `tests/` -- cover every matrix row and a Postgres test of the migration against the local stack -- AC-2
- [x] `scripts/setup-env.mjs`, `.env*.example` -- write `INSTANCE_ID` from the local row; add the new variables -- AC-2
- [x] `components/nova-dashboard.tsx`, `lib/mock-data.ts` -- label the shell synthetic; no persisted-data claim -- AC-3
- [x] `docs/auth-setup.md`, `docs/deployment-setup.md`, `README.md` -- local-stack callbacks, the `staging` promotion flow and Vercel settings Josh must change, module ownership and environment boundaries -- AC-3
- [x] `_bmad-output/implementation-artifacts/deferred-work.md` -- record the deferred fakes and OIDC stand-in against Stories 1.3, 1.4, 1.9 and 2.7 -- housekeeping

**Acceptance Criteria:**
- Given a clean checkout, when `npm ci`, typecheck, build and the suites run, then versions match the lockfile, `engines` allows Node 24, CI pins 24.21.0, `bmad-method` is not a runtime dependency, and a loopback production page responds.
- Given a mixed or unverifiable identity, when the app starts, `check-env --live` runs or a Vercel deployment builds, then it fails naming the mismatch, and a credential-free local build still succeeds.
- Given the shell, when reviewed, then it is labelled synthetic with no persisted-data claim and no table beyond `instance_identity`.

## Spec Change Log

## Design Notes

`lifecycle.instance_identity(id boolean primary key default true check (id), environment text not null check (environment in ('local','staging','production')), instance_id uuid not null default gen_random_uuid(), created_at timestamptz not null default now())`. After `supabase start`, `setup-env.mjs local` reads the row with the local service key and writes `INSTANCE_ID`. Hosted environments insert their row once at provisioning. The build step checks formats and the preview rules only; the row comparison runs at server startup and in `check-env --live`, so a credential-free build still passes. Previews never read the database. `vercel.json` uses `ignoreCommand` (`[ "$VERCEL_GIT_COMMIT_REF" != "staging" ]`) so no other ref builds; promotion is `git push origin main:staging`.

## Verification

**Commands:**
- `npm run typecheck && npm run lint && npm run build` -- expected: exit 0
- `node scripts/test-env.mjs` -- expected: every matrix row passes
- `supabase start && npm test` -- expected: migration and identity tests pass against the local stack

## Suggested Review Order

**Environment identity (the core idea)**

- One row names the environment and instance; startup and build compare against it.
  [`environment.ts:187`](../../lib/environment.ts#L187)

- Preview and local rules: no database keys in previews, loopback only for local.
  [`environment.ts:57`](../../lib/environment.ts#L57)

- The fetch of the row: redirects refused, failures fail closed.
  [`environment.ts:131`](../../lib/environment.ts#L131)

- Server startup runs the check, retries blips, exits on a real mismatch.
  [`instrumentation-node.ts:18`](../../instrumentation-node.ts#L18)

- The startup hook is wired through Next's instrumentation entry.
  [`instrumentation.ts:3`](../../instrumentation.ts#L3)

**Database and local stack**

- The only table: one locked-down row, no access for browser roles.
  [`20261009120000_instance_identity.sql:8`](../../supabase/migrations/20261009120000_instance_identity.sql#L8)

- Local Auth and storage settings, including the 30-day and 7-day session limits.
  [`config.toml:29`](../../supabase/config.toml#L29)

- Local setup writes `.env.local` from the running stack and backs up the old file.
  [`setup-env.mjs:103`](../../scripts/setup-env.mjs#L103)

**Vercel and CI**

- Only the `staging` branch builds; `main` no longer deploys.
  [`vercel.json:5`](../../vercel.json#L5)

- The deployment check runs before every build, and only on Vercel.
  [`check-env.mjs:17`](../../scripts/check-env.mjs#L17)

- CI pins Node 24.21.0 and runs every suite against the local stack.
  [`ci.yml:24`](../../.github/workflows/ci.yml#L24)

**Synthetic shell**

- The dashboard is labelled synthetic, with no claim that anything is saved.
  [`nova-dashboard.tsx:73`](../../components/nova-dashboard.tsx#L73)

**Tests (supporting)**

- Startup behaviour: match, mismatch, unreachable and skipped phases.
  [`startup.test.ts`](../../tests/unit/startup.test.ts)

- Every matrix row, run against a fixture server.
  [`test-env.mjs`](../../scripts/test-env.mjs)

- Migration and access rules against the real local database.
  [`instance-identity.test.ts`](../../tests/integration/instance-identity.test.ts)

- The `.env.local` upgrade path, with a stub CLI.
  [`setup-env.test.ts`](../../tests/unit/setup-env.test.ts)
