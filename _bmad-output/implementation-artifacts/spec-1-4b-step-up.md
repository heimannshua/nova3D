---
title: 'Story 1.4b: Step-up re-authentication and a local fake Google'
type: 'feature'
created: '2026-10-11'
status: 'ready-for-dev'
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-1-context.md'
  - '{project-root}/_bmad-output/implementation-artifacts/spec-1-4a-session-grants.md'
  - '{project-root}/_bmad-output/specs/spec-nova3D-story-1-4/acceptance-criteria.md'
  - '{project-root}/_bmad-output/specs/spec-nova3D-story-1-4/implementation-constraints.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Administration, owner deletion, Account deletion and close-instance (later stories) must be preceded by proof that the person has just signed in again. Nothing can mint or check that proof, and local tests cannot drive a real Google sign-in, the callback's code exchange or a second sign-in.

**Approach:** A server-controlled step-up: a Postgres nonce plus an httpOnly cookie tied to this browser's own OAuth flow, a new Google sign-in that must be the same Account, a 5-minute marker for the new session alone, and the old session's grant revoked. A fake Google for the local stack lets browser tests run the real flow. "Use a different Google account" shows Google's account chooser. Origin and CSRF checks are the next build (1.4c); preferences, the isolation proof and the staging guide follow (1.4d).

## Boundaries & Constraints

**Always:** Consult `node_modules/next/dist/docs/` before writing Next.js code (AGENTS.md). The Account and session come from the verified session; the action class is one of `administration`, `owner_deletion`, `account_deletion`, `close_instance`, and the server derives the return path from it (Settings for now), never from input. The nonce is a Postgres row bound to the Account and the initiating session, with a random secret in an httpOnly cookie (only its hash stored) and a hash of this flow's PKCE verifier, so a sign-in started any other way is not mistaken for the step-up. It expires in 10 minutes, one is outstanding per Account (a new start voids the old), and starts are limited to 10 an hour per Account, counted from the nonce rows. Google starts with `prompt=select_account` and no `login_hint`; `redirectTo` stays exactly `/auth/callback` (a query string fails Auth's allow-list), and the ordinary callback branches on the cookie. One database function accepts a step-up, reading Auth's own tables and never the caller: a new session (not the initiating one) of the same Auth user, with an `oauth` row in `auth.mfa_amr_claims` created at or after the nonce start, the same verified email and the pinned Google subject. In one transaction it issues the new session's grant, writes the marker (this session, the class, 5 minutes), revokes the initiating grant (reason `step_up`), consumes the nonce and audits. A mismatch, expired or replaced nonce, or old sign-in revokes only the new session with local scope and never signs anyone out globally; the person is sent to sign-in with a localized error (the exchange has replaced this browser's cookie, so they sign in again). A marker check for `administration` and `owner_deletion` is reusable for 5 minutes; for `account_deletion` and `close_instance` it is consumed by use and requires a nonce started after a caller-supplied time. Markers live only in Postgres, never in a JWT claim or Redis. Tables stay in non-exposed schemas, closed by default, `service_role` only, with audit events; `api.preflight` probes them. "Use a different Google account" on `/register` ends the session, then restarts Google with `prompt=select_account`. The fake Google is test support: dependency-free, local only, generating its certificates at run time, nothing in the repository that is a key. Strings through the catalogs; Hebrew machine-drafted and flagged. Phone and desktop.

**Ask First:** New environment variables or secrets; changing 10 minutes, 5 minutes or 10 an hour; dropping the verifier binding if the verifier cannot be read reliably; any step against staging or production. HALT if the fake Google or its stack swap cannot be made to work, rather than weakening a check.

**Never:** Origin or CSRF checks (1.4c), preferences, isolation proof or the staging guide (1.4d), disable or recovery UX (1.5, 1.6), or any sensitive action itself. A global sign-out on a failed step-up. A client-chosen Account, session, class, return path or timestamp. Trusting `amr` from a token instead of Auth's table. Logging a cookie secret or verifier.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Same Google account signs in again | nonce open, cookie present | new session has a grant and a marker; old grant revoked; to the return path | N/A |
| Another Google account chosen | mismatch | new session revoked locally; sign-in error; old grant untouched | audited |
| Other browser completes | no cookie there | ordinary sign-in; no marker | N/A |
| Nonce expired or replaced | over 10 minutes, or newer start | rejected as in the mismatch row | N/A |
| Sign-in older than the nonce | `amr` before nonce start | rejected | N/A |
| Eleventh start in an hour | one Account | refused, retry later | N/A |
| Database unreachable | start or accept | denied, retryable; nothing fresh | session kept |
| Marker use | `administration` twice in 5 minutes; after 5 | allowed twice; refused | N/A |
| Marker use | `account_deletion` twice; other session; initiating session | once; refused; refused | N/A |
| Different Google account | `/register` | session ended; Google chooser shown | N/A |

</frozen-after-approval>

## Code Map

- `supabase/migrations/20261010130000_session_grants.sql` -- patterns (closed by default, `security definer`, `search_path=''`, `22023`); `api.issue_grant`, `api.revoke_grants` (session mode), `identity.record_audit`, `api.preflight`. New migration: nonce and marker tables, `api.start_step_up`, `api.complete_step_up`, `api.use_marker`.
- `lib/accounts.ts` -- `callApi`/`callRow`, parsers, `requireActor`; `lib/access.ts` -- `sessionIdOfToken` (:151), `decideSignIn` (:382), `issueSessionGrant` (:408), `claimPreauthorization` (:443); `lib/auth.ts` `withActiveAccount` (:96).
- `app/auth/callback/route.ts` -- exchange (:32), `readUser` (:48): step-up branch goes between, reading the verifier cookie before the exchange.
- `lib/sign-in.ts` (:53 `OAuthClient` lacks `queryParams`), `lib/supabase/{server,sign-out}.ts` (`expireAuthCookies` also removes verifier cookies, so the start follows the expiry), `app/register/actions.ts` (:102), `components/register-form.tsx` (:151).
- `app/account/actions.ts` -- Server Action pattern (budget, `SessionActionState`); new `app/step-up/page.tsx` and its action.
- `tests/support/{forged-session,accounts-data,accounts-db}.ts` -- add `amr` rows and nonce/marker cleanup; `tests/unit/auth-callback-real-client.test.ts` (real client over a stubbed fetch); `tests/integration/accounts.test.ts:30-69` (table and function lists); `tests/unit/gate-structure.test.ts`, `supabase-config.test.ts`.
- Spike (reference only, not committed): `/tmp/claude-1001/-home-josh-repos-nova3D/a41b35a2-67a1-43bb-843c-231d3e7c1096/scratchpad/spike-google/fake/`.
- `docs/auth-setup.md:131-138` (hosted checklist model), `ARCHITECTURE-SPINE.md` AD-12 (:118) and the rate table (:197), `.github/workflows/ci.yml:58-75`.

## Tasks & Acceptance

**Execution:**
- [ ] `supabase/migrations/*` -- nonce and marker tables, the three `api` functions, audit events, preflight, rate count -- AC-4, AC-9
- [ ] `lib/accounts.ts`, `lib/step-up.ts` -- typed calls, cookie handling, class and return-path maps -- AC-4
- [ ] `app/step-up/*`, `app/auth/callback/route.ts` -- localized `/step-up` page with a Server Action start; callback branch; failure handling -- AC-4
- [ ] `lib/sign-in.ts`, `app/register/actions.ts`, `components/register-form.tsx` -- account chooser on "use a different Google account" -- AC-3
- [ ] `lib/i18n/{en,he}.ts` -- messages -- AC-4
- [ ] `tests/support/fake-google.mjs`, a stack-swap script, `package.json`, `.github/workflows/ci.yml`, `playwright.config.ts` -- the fake Google and its wiring; stand-in specs skipped unless active -- AC-4, AC-9
- [ ] `tests/` -- every matrix row at the database; callback branch with the real client; browser flows on desktop and phone in English and Hebrew with axe -- all ACs
- [ ] `docs/auth-setup.md`, `deferred-work.md` -- hosted step-up checklist (AC-9: chooser appears, new `session_id`, `amr` row at or after the nonce start, marker, old grant revoked, single-session setting off), fake Google use, resolved and remaining items -- housekeeping

**Acceptance Criteria:**
- Given a step-up started from a stolen session, when it is completed in another browser or a different Google account signs in, then the initiating session does not become fresh, any marker belongs only to a newly minted session, a mismatch revokes only that session, and an expired or replaced nonce is rejected.
- Given a completed step-up on the fake Google, when the marker is checked, then it belongs to the new session only for the class, expires after 5 minutes and, for Account deletion and close-instance, is consumed by use.
- Given "use a different Google account", when chosen, then Google's account chooser is shown, on phone and desktop.

## Spec Change Log

## Design Notes

Spike result: Auth ignores `[auth.external.google] url`; it reads Google's OIDC discovery from the fixed https `accounts.google.com`, verifies a signed `id_token` and reads `amr` as `[{"method":"oauth","timestamp":...}]` (and one `auth.mfa_amr_claims` row per session). So the fake replaces only the Auth container (same image, env and network) with `HTTPS_PROXY` pointing at a tiny tunnel to a TLS listener for `accounts.google.com`, plus `SSL_CERT_FILE` for its CA; a plain-http listener serves the account chooser, the form-encoded token endpoint and the keys. It honors `prompt=select_account`. A second OAuth sign-in gives a new `session_id` and leaves the old session in Auth. Hosted Auth may differ (a single-session-per-user setting would end the old session), hence the checklist.

## Verification

**Commands:**
- `npm run typecheck && npm run lint && npm run build` -- expected: exit 0
- `supabase start && npm test` -- expected: unit and integration pass, every matrix row covered
- `CI=1 npm run test:e2e` (clean scratch copy, fake Google active) -- expected: all flows pass on both projects
