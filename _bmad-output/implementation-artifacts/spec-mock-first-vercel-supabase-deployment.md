---
title: 'Mock-first Vercel deployment with Supabase auth boundary'
type: 'feature'
created: '2026-09-14'
status: 'done'
review_loop_iteration: 0
baseline_commit: '97c872fbe827c6fad5f5ddbcdf60fc70338992c7'
context:
  - '{project-root}/_bmad-output/planning-artifacts/epics.md'
  - '{project-root}/docs/deployment-setup.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** nova3D has ratified product, UX, architecture, story and qualification artifacts but no root application that can be reviewed or deployed. The inactive Supabase project also prevents immediate provider-backed authentication.

**Approach:** Build a polished mock-first Next.js App Router shell for the core project workflow, preserve the Supabase and Upstash integration boundaries without provider calls, deploy the shell to Vercel, and restore the existing Supabase project when the authenticated management API permits it. Google sign-in and the two requested email identities are configured only when valid Supabase and Google OAuth credentials are available.

## Boundaries & Constraints

**Always:** Next.js 16 App Router, React 19, Tailwind 4, accessible responsive UI, synthetic data only until production credentials exist, no secrets in source or client bundles, route health checks, and reproducible CI/build checks.

**Ask First:** Any Supabase plan upgrade, project replacement, data migration, or Google OAuth credential creation that incurs external billing or changes an existing identity configuration.

**Never:** Railway workers, paid model/provider calls, fabricated Supabase keys, public registration, or claiming that mock data is persisted backend data.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| HAPPY_PATH | Visitor opens deployed root | Responsive My Projects/Create/In Progress shell renders with mock projects and validation status | N/A |
| HEALTH | `GET /api/health` | JSON reports app mode and provider-call false | HTTP 200; no secrets |
| SUPABASE_INACTIVE | Management restore attempted for inactive ref | Restore request is issued and status is polled/reported | Preserve app deployment if restore is unavailable |
| MISSING_OAUTH | Google credentials are absent | Auth remains clearly marked unconfigured; no unsafe partial provider setup | Record actionable setup instructions |

</frozen-after-approval>

## Code Map

- `package.json` -- root runtime and build scripts; currently contains only BMAD tooling and needs the app dependency graph.
- `tools/qualification/stack/app/` -- verified Next/Supabase/Upstash import baseline; reuse its version pins and provider-call-free boundary.
- `scripts/check-env.mjs`, `scripts/test-env.mjs`, `docs/deployment-setup.md` -- existing environment safety contract; keep it authoritative for Vercel settings.
- `vercel.json` -- deployment region/framework configuration; do not hard-code preview as production.
- `_bmad-output/planning-artifacts/epics.md` -- ratified product scope, UX modes and qualification limits; mock shell must not imply completed backend functionality.

## Tasks & Acceptance

**Execution:**
- [x] `package.json`, `package-lock.json`, `app/`, `components/`, `lib/`, `next.config.ts`, `tsconfig.json`, `postcss.config.mjs` -- add the accessible mock-first Next app and health route -- provide a reviewable deployed surface.
- [x] `app/globals.css`, `components/nova-dashboard.tsx` -- implement responsive shadcn-style primitives and project workflow states -- reflect the approved UX contract without backend claims.
- [x] `docs/deployment-setup.md`, `.env*.example`, `scripts/check-env.mjs` -- document and enforce staging/production provider boundaries -- prevent secret leakage and environment mixing.
- [x] Vercel deployment -- deploy the built app and leave durable URL/status evidence.
- [ ] Supabase management operation -- restore the existing project and record the response -- requires a Supabase Management API token with project-admin write scope.

**Acceptance Criteria:**
- Given a clean checkout, when dependencies install and `npm run build` runs, then the build succeeds without provider credentials.
- Given a deployed URL, when `/` and `/api/health` are requested, then they return HTTP 200 and health reports `providerCall: false`.
- Given preview environment variables, when environment checks run, then production settings and paid adapters are rejected.
- Given an inactive Supabase project and authenticated management access, when restore is requested, then the CLI/API response is recorded; no replacement project is created implicitly.
- Given missing Google OAuth credentials, when auth setup runs, then no provider is enabled with placeholders and the deployment remains usable in mock mode.

## Verification

**Commands:**
- `npm run typecheck` -- expected: zero TypeScript errors.
- `npm run build` -- expected: successful production build.
- `node scripts/test-env.mjs && node scripts/ci/check-repository.mjs` -- expected: safety and repository checks pass.
- `npm start -- --hostname 127.0.0.1 --port <port>` plus curl `/` and `/api/health` -- expected: HTTP 200 responses.
- `vercel --prod --yes` -- expected: deployment URL returned.

## Suggested Review Order

**Application entry and mock boundary**

- Start with the dashboard composition and explicit mock-mode disclosure.
  [`components/nova-dashboard.tsx:81`](../../components/nova-dashboard.tsx#L81)

- Confirm the health contract exposes provider-free runtime state.
  [`app/api/health/route.ts:10`](../../app/api/health/route.ts#L10)

**Deployment safety**

- Review environment validation before inspecting deployment configuration.
  [`scripts/check-env.mjs:18`](../../scripts/check-env.mjs#L18)

- Follow the health smoke test that exercises the built production server.
  [`scripts/test-health.mjs:48`](../../scripts/test-health.mjs#L48)

- Inspect CI’s application build and qualification checks.
  [`.github/workflows/ci.yml:18`](../../.github/workflows/ci.yml#L18)

**External integration boundary**

- Review the token-gated restore operation and its no-replacement behavior.
  [`scripts/restore-supabase.mjs:1`](../../scripts/restore-supabase.mjs#L1)

- Review Google sign-in setup and the two initial email identities.
  [`docs/auth-setup.md:1`](../../docs/auth-setup.md#L1)
