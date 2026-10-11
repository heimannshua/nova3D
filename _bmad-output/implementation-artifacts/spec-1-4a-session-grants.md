---
title: 'Story 1.4a: Session grants and live authorization'
type: 'feature'
created: '2026-10-10'
status: 'done'
baseline_commit: 'f29b60ee7a370fa009bf77d69a19ab69a985ba09'
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-1-context.md'
  - '{project-root}/_bmad-output/implementation-artifacts/spec-1-3-create-invitation-only-accounts.md'
  - '{project-root}/_bmad-output/implementation-artifacts/spec-1-3-part-b-registration-and-account-gating.md'
  - '{project-root}/_bmad-output/specs/spec-nova3D-story-1-4/acceptance-criteria.md'
  - '{project-root}/_bmad-output/specs/spec-nova3D-story-1-4/implementation-constraints.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** A valid Google session plus an active Account is enough to browse. Nothing can revoke one session, sign out other devices, expire a session by age or idleness, or end a session from the app, and the gate asks Auth and the database separately on every request.

**Approach:** Add Identity-owned session grants: one is issued whenever a signed-in session becomes an active Account's, one authorization call verifies it on every private request, and one revocation primitive works by session, by Account and by epoch. Add sign-out and "sign out my other sessions". Steps 1.4b (step-up, origin and CSRF checks) and 1.4c (preferences, isolation proof, staging guide) follow.

## Boundaries & Constraints

**Always:** Consult `node_modules/next/dist/docs/` before writing Next.js code (AGENTS.md). Tables stay in non-exposed schemas; the only callable surface is schema `api`, `EXECUTE` for `service_role` alone, closed by default; new audit events for issue and revoke. The session ID comes from the verified access token's `session_id`, never from input. `api.authorize_session(user_id, session_id)` returns one row (state, Account, workspace, role, epoch) and replaces the proxy's and page's separate Account lookups. A grant is valid only if it is not revoked, issued within 30 days, last used within 7 days (updated at most once a minute) and its epoch is at least the Account's; Auth's own time-box in `supabase/config.toml` stays as well. A session with no grant is refused as signed out (existing sessions end at cutover). Any Auth or database failure denies access with a retryable page, keeps the session and honors nothing cached. Sign-out must revoke the grant first: if that cannot be recorded, say so and keep the session so the person can retry. Revoking by epoch means raising `accounts.authorization_epoch`; a grant records the epoch at issue. Re-check the pinned Google subject during authorization and revoke on mismatch. Strings go through the catalogs; Hebrew is machine-drafted and flagged. Phone and desktop.

**Ask First:** New secrets or environment variables; changing 30 days, 7 days or the one-minute touch interval; any step against staging or production.

**Never:** Build step-up, markers, CSRF or preferences (1.4b, 1.4c), disable or recovery UX (1.5, 1.6), or a Redis dependency. Let a client choose a user ID, session ID, Account, role or epoch. Honor a revoked, expired, idle or stale-epoch grant. Log tokens.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Sign-in completes | callback, active Account | one grant for the `session_id` | error: sign out, `auth_unavailable` |
| Registration or claim activates an Account | current session | one grant for it | idempotent |
| Valid grant | any private request | page renders; last-used touched at most once a minute | N/A |
| No grant | valid JWT, active Account | refused as signed out | no private content |
| Revoked grant | valid JWT | refused everywhere | N/A |
| Stale epoch | Account epoch raised | older grants refused | N/A |
| 31-day or 8-day-idle grant | timestamps | refused; sign in again | N/A |
| Sign out | menu | grant revoked, cookies cleared; old JWT refused | revoke fails: retryable error, session kept |
| Sign out my other sessions | Settings | other grants revoked, current continues | N/A |
| Disabled Account | any request | signed out; disabled message; no private content | N/A |
| Database unreachable | any private request | denied, retryable page; session kept | no Account change |
| Pinned subject changed | Administrator, another Google identity | grant revoked, refused, audited | N/A |
| Private `/api` denial | fetch without access | 401 or 403 JSON, not HTML | N/A |

</frozen-after-approval>

## Code Map

- `proxy.ts`, `lib/access.ts`, `lib/auth.ts`, `lib/supabase/{proxy,server,sign-out}.ts` -- the gate; replace the two lookups with `authorize_session`, add JSON denials for `/api`.
- `app/auth/callback/route.ts`, `app/register/actions.ts` -- issue the grant when a session becomes an active Account's (callback, `/register` claim, registration).
- `supabase/migrations/*_accounts.sql`, `*_api.sql`, `lib/accounts.ts` -- patterns for tables, closed-by-default privileges, `api` functions and typed service-role calls.
- `components/shell/shell.tsx` (Account menu), `components/settings/*` -- sign-out and "sign out my other sessions".
- `tests/support/{stack,forged-session,accounts-db}.ts`, `tests/e2e/registration.spec.ts` -- forged sessions now need a grant.
- `_bmad-output/implementation-artifacts/deferred-work.md` -- entries mapped to 1.4 (Account menu sign-out; JSON for `/api`; double lookup; pinned subject; refresh-deadline).

## Tasks & Acceptance

**Execution:**
- [x] `supabase/migrations/*` -- `identity.session_grants`, `accounts.authorization_epoch`; `api.issue_grant`, `api.authorize_session`, `api.revoke_grants` (session, Account, below-epoch) and an epoch bump; audit events; RLS on, no policies, closed by default -- AC-2, 6, 8, 10, 11
- [x] `lib/accounts.ts`, `lib/access.ts`, `lib/auth.ts`, `proxy.ts` -- one authorization call per request (memoized in the page with React `cache()`), retryable denial, JSON for `/api`, pinned-subject recheck -- AC-2, 3, 6, 10
- [x] `app/auth/callback/route.ts`, `app/register/actions.ts`, `lib/access.ts` -- issue the grant on sign-in, claim and registration -- AC-8
- [x] Account menu sign-out and Settings "sign out my other sessions" (Server Actions, localized, phone and desktop) -- AC-8, 11
- [x] `tests/` -- migration and every matrix row at the database; forged sessions issue grants; browser flows for revoked, expired, idle, stale-epoch, sign-out, other-sessions, outage (fake network) and `/api` JSON, on desktop and phone in English and Hebrew with axe -- all ACs
- [x] `docs/auth-setup.md`, `deferred-work.md` -- cutover note (all sessions end), resolved and remaining items -- housekeeping

**Acceptance Criteria:**
- Given a valid JWT with a revoked, expired, idle, stale-epoch or missing grant, or an inactive Account, when a private request arrives, then it is refused even if the UI is bypassed.
- Given a failed sign-in, an unregistered identity, an Administrator session or a disabled Account, when browsing is attempted, then failure states are usable and no private data is shown, on phone and desktop.
- Given Postgres unreachable, when a private request arrives, then it is denied with a retryable state and no cached JWT or grant is honored.
- Given a completed sign-in then sign-out, when the old token is used, then it is refused; given several sessions, when "sign out my other sessions" is chosen, then every other grant is revoked at once and the current session continues, on phone and desktop.
- Given a session older than 30 days or idle for more than 7, when a private request arrives, then it is refused and the person must sign in again.

## Spec Change Log

## Design Notes

Part B left `getUser()` as the proof of identity; the session ID comes from the same verified token (use `getClaims()` or decode the access token after `getUser()` succeeds, per the docs). Grants are created only for an active Account's session, so an unregistered identity has none; `authorize_session` therefore returns `unregistered` when the user has no Account, and the grant states otherwise. Revocation by Account and by epoch are for 1.5 (disable) and 1.6 (recovery). The refresh-deadline item stays deferred: Auth's 10-second refresh-token reuse interval covers the practical case, so record the evaluation. Hosted staging pushes are manual until Story 1.9.

## Verification

**Commands:**
- `npm run typecheck && npm run lint && npm run build` -- expected: exit 0
- `supabase start && npm test` -- expected: unit and migration tests pass, every matrix row covered
- `CI=1 npm run test:e2e` (clean scratch copy) -- expected: all flows pass on both projects

## Suggested Review Order

**The decision (the core idea)**

- One call answers "which Account" and "is this session's grant valid": Account state, then grant, then the pinned Google subject.
  [`session_grants.sql:223`](../../supabase/migrations/20261010130000_session_grants.sql#L223)

- The session ID is the `session_id` of the token Auth has just verified for that user, never an input; a token that names none is `unavailable`.
  [`access.ts:151`](../../lib/access.ts#L151)

- Every grant state becomes one access state (signed out, session ended, refused, disabled, unregistered, active); anything unexpected is `unavailable`.
  [`access.ts:228`](../../lib/access.ts#L228)

**Granting and revoking**

- Issue: idempotent, never revives a revoked grant, refuses a session Auth does not have and an identity that is not the pinned one.
  [`session_grants.sql:144`](../../supabase/migrations/20261010130000_session_grants.sql#L144)

- The one revocation primitive (session, Account, below an epoch), final and audited per grant; the epoch only rises.
  [`session_grants.sql:308`](../../supabase/migrations/20261010130000_session_grants.sql#L308)

- Where a grant is issued: callback and `/register` claim share one function, registration has its own call.
  [`access.ts:408`](../../lib/access.ts#L408)

- A retried registration gets its grant only if the database confirms this command and code created the Account, so a stolen old cookie cannot buy one.
  [`session_grants.sql:414`](../../supabase/migrations/20261010130000_session_grants.sql#L414)

- Sign-out revokes first and keeps the session, saying so, if that cannot be recorded.
  [`actions.ts:24`](../../app/account/actions.ts#L24)

**Every request**

- The proxy: one authorization per private request, JSON for `/api`, refreshed cookies carried on a denial.
  [`proxy.ts:71`](../../proxy.ts#L71)

- The page asks again, once per render.
  [`auth.ts:37`](../../lib/auth.ts#L37)

**Tests (supporting)**

- Every matrix row at the database, including the races.
  [`session-grants.test.ts`](../../tests/integration/session-grants.test.ts)

- Browser flows on desktop and phone, with the fake network for outages.
  [`authorization.spec.ts`](../../tests/e2e/authorization.spec.ts)
