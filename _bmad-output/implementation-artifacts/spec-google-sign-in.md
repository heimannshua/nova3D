---
title: 'Local Google auth and interim access removal'
type: 'bugfix'
created: '2026-09-15'
status: 'done'
review_loop_iteration: 0
baseline_commit: 'd98e31c47132fa97731b60c814876a7477e57d1a'
context:
  - '{project-root}/docs/auth-setup.md'
  - '{project-root}/docs/deployment-setup.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Google OAuth works from the deployed Vercel origin but local development fails when the app is opened at `127.0.0.1` or the LAN address because Next.js blocks those dev origins. The local environment also lacks the configured email allowlist, so a valid Google identity cannot be admitted by the callback.

**Approach:** Allow the supported local origins in Next.js development, document and configure the local Supabase/Google callback contract, and remove the temporary shared-password access path now that Google authentication is active. Keep the dashboard private behind the allowlisted Supabase user session.

## Boundaries & Constraints

**Always:** Use the existing Supabase SSR cookie/session flow; allow only the configured email addresses; keep provider secrets out of source and browser-visible variables; keep local, staging, and production configuration distinct; preserve truthful health reporting.

**Ask First:** Any change to Supabase provider credentials, Google OAuth clients, redirect allowlists, invited accounts, or database/project resources.

**Never:** Restore or replace the interim password as an alternate login; commit `.env.local` or any OAuth secret; bypass Supabase Auth; make the mock dashboard appear persisted.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|---|---|---|---|
| LOCAL_HOST | App opened at localhost, loopback, or configured LAN origin | Google button hydrates and starts OAuth with that origin's callback URL | Next dev resources are not blocked; failures remain on the login page |
| GOOGLE_CALLBACK | Valid Google callback for an allowlisted account | PKCE code becomes a Supabase cookie session and redirects to `/` | Invalid, expired, or disallowed identities redirect internally to login |
| NO_INTERIM | No interim password environment variable or route | Login exposes Google only; interim endpoint is unavailable | No temporary credential or session cookie is accepted |

</frozen-after-approval>

## Code Map

- `next.config.ts` -- Next.js 16 configuration; currently has no `allowedDevOrigins`, while the running dev server logs blocks for `127.0.0.1` and `10.103.0.9`.
- `.env.local`, `.env.example`, `.env.staging.example`, `.env.production.example` -- environment contract; `.env.local` has valid public Supabase settings but is missing `AUTH_ALLOWED_EMAILS`; examples still advertise interim and unused Google secret variables.
- `components/login-form.tsx` -- client OAuth entry point; remove interim form/state and retain the existing `signInWithOAuth` callback behavior.
- `proxy.ts`, `lib/auth.ts` -- dashboard access boundary; remove signed interim-cookie branches and require an allowlisted Supabase user.
- `app/api/auth/interim/route.ts`, `lib/interim-auth.ts` -- temporary password implementation; delete because the fallback is no longer part of the supported auth surface.
- `app/auth/callback/route.ts`, `app/api/health/route.ts` -- callback error and health contracts; remove interim references while preserving safe redirects and auth status.
- `docs/auth-setup.md`, `docs/deployment-setup.md` -- setup guidance; describe Google-only access and no temporary-password cleanup step.

## Tasks & Acceptance

**Execution:**
- [x] `next.config.ts` -- allow localhost, loopback, and the current LAN dev origin for Next.js dev resources -- make the login component hydrate on every supported local URL.
- [x] `.env.local` -- add the two configured allowlisted emails without exposing secrets -- allow local callback authorization.
- [x] `components/login-form.tsx`, `proxy.ts`, `lib/auth.ts` -- remove interim access and keep Google/Supabase session enforcement -- eliminate the shared-password login surface.
- [x] `app/api/auth/interim/route.ts`, `lib/interim-auth.ts` -- remove the obsolete endpoint and signing implementation -- prevent fallback sessions.
- [x] `app/auth/callback/route.ts`, `app/api/health/route.ts`, `docs/auth-setup.md`, `docs/deployment-setup.md`, `.env*.example` -- remove stale interim references and unused provider-secret variables -- keep setup instructions truthful.
- [x] Vercel production -- remove `NOVA_INTERIM_PASSWORD` and redeploy -- ensure production has no temporary access path.

**Acceptance Criteria:**
- Given the dev server is bound to `0.0.0.0`, when `/login` is opened at `localhost`, `127.0.0.1`, or the current LAN address, then the Google button is hydrated and initiates OAuth.
- Given a valid Google callback for either configured email, when the callback route exchanges the code, then the user reaches the dashboard with a Supabase session.
- Given any other email or invalid callback, when auth completes, then access is denied with an internal login redirect and no session remains.
- Given the app or Vercel deployment, when the login page and auth routes are inspected, then no interim password form, endpoint, cookie, or environment variable is available.

## Verification

**Commands:**
- `npm run typecheck` -- expected: zero TypeScript errors.
- `npm run lint` -- expected: no ESLint errors.
- `npm run test:dev-origins` -- expected: supported local origin parsing passes.
- `npm run build` -- expected: successful production build.
- `node scripts/test-env.mjs` -- expected: environment safety tests pass.
- `curl http://127.0.0.1:3000/api/health` -- expected: HTTP 200 and no interim gate field.

**Manual checks:**
- Open local login at all three supported origins and confirm the Google button navigates to Google.
- Confirm production no longer renders or accepts interim password access after redeploy.

## Suggested Review Order

**Auth boundary**

- The client now exposes only the configured Google entry point and handles malformed local configuration safely.
  [`login-form.tsx:25`](../../components/login-form.tsx#L25)

- The proxy and server boundary require allowlisted Supabase users while clearing legacy fallback cookies.
  [`proxy.ts:16`](../../proxy.ts#L16)

- The callback still exchanges PKCE codes server-side and rejects non-allowlisted identities.
  [`route.ts:5`](../../app/auth/callback/route.ts#L5)

**Environment and local parity**

- Required deployment validation now prevents a missing allowlist from shipping an inaccessible workspace.
  [`check-env.mjs:4`](../../scripts/check-env.mjs#L4)

- The shared origin parser keeps localhost, loopback, and LAN development behavior testable.
  [`dev-origins.ts:1`](../../lib/dev-origins.ts#L1)

**Removal and verification**

- Health and environment tests lock the Google-only runtime contract.
  [`test-health.mjs:17`](../../scripts/test-health.mjs#L17)

- CI exercises the local-origin configuration alongside the build and auth guardrails.
  [`ci.yml:38`](../../.github/workflows/ci.yml#L38)

- The Next.js config applies the supported local origins to dev-resource protection.
  [`next.config.ts:4`](../../next.config.ts#L4)
