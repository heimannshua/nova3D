---
title: 'Google sign-in with Supabase'
type: 'feature'
created: '2026-09-14'
status: 'draft'
review_loop_iteration: 0
context:
  - '{project-root}/docs/auth-setup.md'
  - '{project-root}/docs/deployment-setup.md'
  - '{project-root}/_bmad-output/planning-artifacts/architecture/architecture-nova3D-2026-09-14/ARCHITECTURE-SPINE.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** nova3D currently renders a mock dashboard without a real authentication entry point, while the intended product requires private authenticated workspaces and Google as the first social provider.

**Approach:** Add the Supabase SSR browser/server clients, a PKCE callback route, and a Google sign-in control. Keep the app private while provider credentials are absent with a temporary, expiring password gate; remove that fallback after the two allowlisted Google accounts are active. Restore and configure the existing Supabase project only when it is active and the user supplies a Google Web OAuth client; keep all secrets in deployment configuration.

## Boundaries & Constraints

**Always:** Use `@supabase/ssr` cookie-aware clients; exchange callback codes server-side; keep OAuth secrets server-only; require an authenticated or temporary-gate session before the dashboard; allow only the two configured email addresses through Google; avoid public registration and cross-workspace access claims.

**Ask First:** Any Google OAuth client creation, Supabase plan change, project replacement, or change to existing identity/provider configuration. The existing inactive project may be restored, but it must not be replaced implicitly.

**Never:** Commit client secrets, put secrets in `NEXT_PUBLIC_*`, fabricate provider credentials, bypass Supabase Auth with a second session system, or claim the synthetic dashboard data is persisted.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|---|---|---|---|
| CONFIGURED | Valid public Supabase URL/key and active Google provider | Google control starts `signInWithOAuth` and callback exchanges the PKCE code into a cookie session | Surface a concise sign-in failure and keep the page usable |
| UNCONFIGURED | Missing/placeholder Supabase browser variables or inactive provider | No OAuth request is made; the login screen offers the temporary password gate when configured | No secret or fabricated identity is shown |
| CALLBACK_ERROR | Missing/invalid/expired callback code or unsafe `next` | Redirect to a safe auth error state or `/` | Never redirect to an external URL |

</frozen-after-approval>

## Code Map

- `app/page.tsx` -- current public App Router entry; preserve mock-first rendering while adding the authentication boundary.
- `components/nova-dashboard.tsx` -- client-only shell with the static Josh account chip and mock-mode disclosure; add the sign-in affordance and configured/unconfigured states here without inventing persisted user data.
- `app/api/health/route.ts`, `lib/mock-data.ts` -- current provider-free health contract and mock status source; retain truthful health reporting while auth configuration is incomplete.
- `@supabase/ssr` and `@supabase/supabase-js` in `package.json` -- already pinned and available; no dependency upgrade is needed.
- `docs/auth-setup.md`, `docs/deployment-setup.md`, `.env*.example` -- existing secret and deployment contract; update callback, redirect allow-list, inactive-project, and Google credential instructions without adding secrets.
- `supabase/config.toml` -- local Supabase configuration; document the local Google provider shape only if needed, with secrets sourced from environment.
- Existing code evidence: no `createClient`, `middleware`, `/auth/callback`, `signInWithOAuth`, or real session handling is present; the current UI is explicitly mock mode.

## Tasks & Acceptance

**Execution:**
- [ ] `lib/supabase/client.ts`, `lib/supabase/server.ts` -- add cookie-aware browser and server clients with safe missing-environment handling -- support the browser OAuth start and server callback.
- [ ] `app/auth/callback/route.ts` -- exchange the Supabase PKCE code and redirect only to a relative destination -- persist the authenticated cookie session safely.
- [ ] `proxy.ts`, `app/api/auth/interim/route.ts`, `lib/interim-auth.ts` -- protect the dashboard with a temporary signed session while Google setup is pending -- expire sessions and keep the password server-only.
- [ ] `components/nova-dashboard.tsx`, `app/page.tsx` -- add a clear Google sign-in entry point and auth/configuration feedback while preserving provider-free mock mode -- make the feature discoverable without false persistence claims.
- [ ] `docs/auth-setup.md`, `docs/deployment-setup.md`, `.env.example`, `.env.staging.example`, `.env.production.example` -- document Google Cloud, Supabase Auth, redirect allow-list, and deployment variables -- make the remaining user-owned setup executable.
- [ ] `app/auth/callback/route.ts`, client auth flow -- manually or with focused tests cover configured, unconfigured, callback-error, and unsafe-redirect cases -- prevent silent auth failures.

**Acceptance Criteria:**
- Given valid browser Supabase variables and an active Google provider, when the user selects Google sign-in, then Supabase receives a Google OAuth request with a callback URL on the current app origin.
- Given a valid callback code, when `/auth/callback` receives it, then the server exchanges it for a session and redirects to a safe relative destination.
- Given missing, placeholder, or inactive provider configuration, when the home page loads, then no OAuth request is attempted and the existing mock-mode shell remains usable with truthful setup messaging.
- Given an unsafe external `next` value or callback error, when the callback route handles it, then the user is redirected internally without an open redirect or secret leakage.
- Given a clean checkout, when `npm run typecheck`, `npm run lint`, and `npm run build` run, then all complete successfully without real provider credentials.

## Verification

**Commands:**
- `npm run typecheck` -- expected: zero TypeScript errors.
- `npm run lint` -- expected: no ESLint errors.
- `npm run build` -- expected: successful production build without provider credentials.
- `node scripts/test-env.mjs` -- expected: existing environment safety checks pass.

**Manual checks:**
- With a configured active project, click Google sign-in and verify the callback returns to the app with a session.
- With local placeholder variables or an inactive provider, verify the shell remains usable and exposes no secret values.
