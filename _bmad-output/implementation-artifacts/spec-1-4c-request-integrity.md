---
title: 'Story 1.4c: Origin and CSRF checks for state-changing requests'
type: 'feature'
created: '2026-10-11'
status: 'done'
baseline_commit: '2765fc327003f9224009df2dfc919210cb732ad3'
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-1-context.md'
  - '{project-root}/_bmad-output/implementation-artifacts/spec-1-4a-session-grants.md'
  - '{project-root}/_bmad-output/specs/spec-nova3D-story-1-4/acceptance-criteria.md'
  - '{project-root}/_bmad-output/specs/spec-nova3D-story-1-4/implementation-constraints.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** A state-changing request that carries a valid session cookie is trusted whichever site sent it. Next checks the origin for Server Actions only, and lets a missing one through; a plain route handler gets no check at all.

**Approach:** The proxy refuses any non-safe request whose origin is not this app's. A per-session CSRF token, issued once per session and stored only as a hash on the session grant, is required by one helper, `requireMutationAccess`, for every mutation that is not a Server Action. Preferences, the isolation proof and the staging guide follow (1.4d).

## Boundaries & Constraints

**Always:** Consult `node_modules/next/dist/docs/` before writing Next.js code (AGENTS.md). Safe methods (GET, HEAD, OPTIONS) are not checked. Every other method must pass first: an `Origin` that is present, is not `null` and whose host equals the first `x-forwarded-host`, else `host` (as Next compares for Server Actions), and a `Sec-Fetch-Site` that is not `cross-site`. A missing `Origin` on a request that would otherwise proceed is refused. The check runs after the access decision, so a denied request keeps its 401, 403 or redirect, and it also applies to public paths. A refusal is 403 JSON for `/api` and a plain 403 elsewhere, never a redirect. The CSRF token is 256 random bits per session; only its SHA-256 is stored, as `csrf_hash` and `csrf_issued_at` on the grant, and it is delivered in cookie `nova3d-csrf` (readable by page script, Secure on https, SameSite Lax, path `/`), which script echoes in header `x-csrf-token`. The proxy issues it on an authorized page request (document navigation) that carries no such cookie: `api.issue_csrf` stores the hash when the grant has none or its hash is over 60 seconds old, otherwise leaves it, so two tabs racing keep one token; a failure issues nothing and never blocks the page. Grants made before this story, and step-up grants, get theirs on their next page request. `requireMutationAccess(request)` (lib/auth.ts) does the origin check, then `requireApiAccess`, then `api.verify_csrf` of the header's hash against the grant of the verified session; its denials are 403 JSON (`origin_not_allowed`, `csrf_invalid`) and a retryable 503 when the database cannot answer. Every non-GET route handler under `app/api` must start from it, enforced by a structural test. Server Actions need no token: Next's host check and the proxy's origin check cover them. New `api` functions are closed by default and `service_role` only; user and session come from the verified token, never input; a token is never logged or stored raw; `api.preflight` probes the new columns. A synthetic-only route, 404 unless synthetic data is on (gated like `/kit`), gives tests a real non-Server-Action mutation with observable state and has no other behavior.

**Ask First:** New environment variables or secrets; changing the 60 seconds, the cookie or the header name; any step against staging or production.

**Never:** Redis. CORS headers or any extra allowed origin. A token requirement for Server Actions. Changes to how grants are issued, revoked or step-up works. Trusting a token without comparing its hash. Preferences, the isolation proof or the staging guide (1.4d). Logging a token.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Same-origin mutation | Server Action or route, own origin, valid token | proceeds | N/A |
| Foreign origin | non-safe request, other host | 403 before any state change | N/A |
| Origin `null` or missing | cookie-authenticated, would proceed | 403 | N/A |
| Cross-site fetch metadata | `Sec-Fetch-Site: cross-site`, matching Origin | 403 | N/A |
| Signed out or no grant | non-safe request | the existing 401, 403 or redirect | N/A |
| Missing, wrong or another session's token | route mutation, own origin | 403 `csrf_invalid`, no state change | N/A |
| Safe method | GET, HEAD, OPTIONS | not checked | N/A |
| First page request of a session | no `nova3d-csrf` cookie | cookie set, hash stored | issue fails: no cookie, page renders |
| Two first requests at once | same grant | one token stands | N/A |
| Cookie lost over a minute later | hash over 60 s old | replaced | N/A |
| Database unreachable | token check | 503 retryable | no state change |
| Older grant | hash is null | token on its next page request | N/A |

</frozen-after-approval>

## Code Map

- `proxy.ts` -- the gate (:71 `proxy`); origin check after the access decision (:81-88), the cookie issue on the allowed GET page request; `lib/supabase/proxy.ts` `carry`/`next` for the extra cookie.
- `lib/auth.ts` -- `requireApiAccess` (:69), `withActiveAccount` (:96); add `requireMutationAccess`. `lib/access.ts` -- `apiDenial`, `apiDenialResponse`, `AccessUser.sessionId`.
- `lib/accounts.ts` -- `callApi`/`callRow`, `requireUuid`; add typed `issueCsrf` and `verifyCsrf`. `tests/unit/gate-structure.test.ts` allows `authorizeSession` in `lib/access.ts` and `lib/accounts.ts` only.
- `supabase/migrations/20261010130000_session_grants.sql` -- `identity.session_grants` (:62), `guard_session_grant` (:83, the new columns stay writable on a live grant only), `api.authorize_session` (:223). `20261011120000_step_up.sql` -- latest `api.preflight`, replaced again here.
- `lib/public-paths.ts`, `app/kit/page.tsx` -- the synthetic-only gating to copy; `.env.example` sets `SYNTHETIC_DATA_ENABLED=true` for tests.
- `tests/unit/proxy-gating.test.ts` (POSTs at :185, :204, :410, :470-482 send no `Origin`; those that expect to pass need one), `tests/e2e/authorization.spec.ts` (:674-675 signed-out `/api` POST and DELETE stay 401), `tests/integration/accounts.test.ts` (function lists), `tests/support/{forged-session,e2e-helpers}.ts`.
- `docs/auth-setup.md` -- hosted checks; `ARCHITECTURE-SPINE.md` AD-12 and "Cookie mutations require origin/CSRF checks" (:171).

## Tasks & Acceptance

**Execution:**
- [x] `supabase/migrations/*` -- `csrf_hash` and `csrf_issued_at` on `identity.session_grants`, `guard_session_grant`, `api.issue_csrf`, `api.verify_csrf`, preflight -- AC-5
- [x] `lib/request-integrity.ts` (pure: origin decision, token and header names, hashing helpers), `lib/accounts.ts` -- AC-5
- [x] `proxy.ts`, `lib/supabase/proxy.ts` -- origin check; cookie issue on a page request -- AC-5
- [x] `lib/auth.ts`, `lib/csrf-client.ts` (browser-safe: reads the cookie, adds the header), `app/api/kit/mutation/route.ts` (synthetic-only; a GET that reports a counter, a POST that bumps it) -- `requireMutationAccess` and its first user -- AC-5
- [x] `tests/` -- every matrix row: pure decision, proxy decisions, database, browser flows (a Server Action replayed with a foreign, `null` and no origin; the route with and without a token; the cookie issued once) on desktop and phone; structural test that every non-GET `app/api` handler uses the helper -- all ACs
- [x] `docs/auth-setup.md`, `deferred-work.md` -- what the checks do, what a proxy must forward, a hosted check for Josh, resolved and remaining items -- housekeeping

**Acceptance Criteria:**
- Given a cookie-authenticated mutation from a foreign origin, or without its CSRF token, when it is submitted, then it is rejected before any state change, while the same request from the application's own origin succeeds.
- Given an older session whose grant has no token, when its next page is requested, then it receives one.
- Given the database cannot answer, when a route mutation is checked, then it is refused as retryable and nothing changes.

## Spec Change Log

## Design Notes

Why the proxy issues the token, not each place a grant is made: grants are created in four places, one inside the database (`api.complete_step_up`), and older ones have none. One lazy issue covers all of them. Replacing an old hash only when the request has no cookie is safe: an attacker can neither read the new cookie nor trigger it while the victim's cookie exists. The 60-second rule keeps two racing first requests from leaving the cookie and the hash different. Next compares `new URL(Origin).host` with the first `x-forwarded-host`, else `host`, and lets a missing Origin through; this story is stricter for every non-safe method, Server Actions included.

## Verification

**Commands:**
- `npm run typecheck && npm run lint && npm run build` -- expected: exit 0
- `supabase start && npm test` -- expected: unit and integration pass, every matrix row covered
- `CI=1 npm run test:e2e` (clean scratch copy; start the stack as CI does, with the fake Google active) -- expected: all flows pass on both projects

## Suggested Review Order

**The decision (the core idea)**

- One pure function says whether a non-safe request is from this application: a present, non-`null` `Origin` whose host is the first `x-forwarded-host`, else `host`, and no cross-site fetch.
  [`request-integrity.ts:114`](../../lib/request-integrity.ts#L114)

- The proxy applies it after the access decision, so a denied request keeps its 401, 403 or redirect, and to public paths too; the refusal is a 403, never a redirect.
  [`proxy.ts:152`](../../proxy.ts#L152)

**The token**

- Issue: the database stores the hash only when the grant has none or it is a minute old or older, under the grant's row lock, so two tabs racing keep one token and only a stored hash is delivered.
  [`request_integrity.sql:74`](../../supabase/migrations/20261011130000_request_integrity.sql#L74)

- Check: the hash of the header against the grant of the verified session, which must itself be valid.
  [`request_integrity.sql:128`](../../supabase/migrations/20261011130000_request_integrity.sql#L128)

- The proxy hands a signed-in browser its token on a document navigation that carries no cookie, and never lets a failure block the page.
  [`proxy.ts:90`](../../proxy.ts#L90)

- The cookie goes with its session: the callback removes it when the browser gets a different session (the case the spec did not name, and the one a step-up hits), or the new session never gets its own.
  [`route.ts:67`](../../app/auth/callback/route.ts#L67)

**The helper every route mutation starts from**

- Origin, then the active Account, then the token, with the user and session from the verified session; a database that cannot answer is a retryable 503.
  [`auth.ts:125`](../../lib/auth.ts#L125)

- The structural test reads every route handler under `app` and fails unless a non-safe one starts from its guard; the synthetic route may check its flag first, by name.
  [`gate-structure.test.ts`](../../tests/unit/gate-structure.test.ts)

**Tests (supporting)**

- Every database row, including the races.
  [`request-integrity.test.ts`](../../tests/integration/request-integrity.test.ts)

- The proxy's origin and cookie decisions with a fake network.
  [`proxy-gating.test.ts:713`](../../tests/unit/proxy-gating.test.ts#L713)

- Browser flows on desktop and phone, including a Server Action replayed with a foreign, `null` and no origin, and the step-up against the fake Google.
  [`request-integrity.spec.ts`](../../tests/e2e/request-integrity.spec.ts)

