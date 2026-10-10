---
title: 'Story 1.3 (Part B: app): Registration screen and live-Account gating'
type: 'feature'
created: '2026-10-10'
status: 'done'
baseline_commit: 'bc07499898a0f916df70e6d21e3b183c0188cc78'
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-1-context.md'
  - '{project-root}/_bmad-output/implementation-artifacts/spec-1-3-create-invitation-only-accounts.md'
  - '{project-root}/_bmad-output/specs/spec-nova3D-story-1-3/acceptance-criteria.md'
  - '{project-root}/_bmad-output/specs/spec-nova3D-story-1-3/implementation-constraints.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Part A built Accounts, codes and the seed in the database, but the app still lets in anyone on the `AUTH_ALLOWED_EMAILS` list. There is no registration screen, nothing consumes a seeded pre-authorization at sign-in, and a Google identity without an Account is not kept out.

**Approach:** Sign-in consumes a pre-authorization, every private route requires a live active Account, an identity without one reaches only a localized registration screen, and `AUTH_ALLOWED_EMAILS` is removed everywhere. Any failure of the check denies access.

## Boundaries & Constraints

**Always:** Consult `node_modules/next/dist/docs/` before writing Next.js code (AGENTS.md); proxy runs on Node and Server Actions compare Origin to Host. The user is always taken from the verified server session (`getUser()`), never from form input. `lib/accounts.ts` is imported by server code only. Failures to register are generic and localized in English and Hebrew; never log or echo a code. A registration attempt carries a command UUID: reuse it only to retry an attempt whose outcome is unknown (the database was unreachable), and mint a new one after any definitive answer. A database error anywhere in gating or sign-in denies access (fail closed). `/register` is a signed-in-only page without the navigation shell. The registration screen states that the instance operator administers the hosting accounts that hold users' data. The two hash keys become required at startup in every non-preview environment; previews still must not hold them. Every screen works on phone and desktop.

**Ask First:** Changing rate limits; adding Redis; any step against staging or production (Josh applies migrations, sets keys and seeds). HALT if forged-session browser tests (see Design Notes) cannot be made to work, rather than weakening a check.

**Never:** Build session grants, step-up or sensitive-action checks (Story 1.4), disable and re-enable UX (1.5), recovery (1.6) or the Administrator invitation screen (1.11). Keep `AUTH_ALLOWED_EMAILS` or `allowedEmail`/`authAllowedEmails` anywhere. Trust a client-supplied user ID, role or status.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Signed out | any private path | redirect to `/login?error=not_signed_in` | N/A |
| Active Account | any private path | page renders | N/A |
| No Account | any path except `/register` | redirect to `/register` | N/A |
| No Account | `/register` | registration form with the operator notice | N/A |
| Active Account | `/register` | redirect to `/` | N/A |
| Disabled Account | any path | signed out; `/login?error=account_disabled`; no private content | N/A |
| Seeded address, first sign-in | callback | pre-authorization consumed; Account created; redirect `/` | audited (Part A) |
| Subject mismatch | callback | signed out; `/login?error=not_allowed` | N/A |
| Valid code | registration action | Account and Workspace; redirect `/` | N/A |
| Bad, used, revoked or limited code | registration action | generic localized message, fresh command ID | counted (Part A) |
| Database unreachable | proxy, page, callback or action | access denied; callback and gating redirect to `/login?error=auth_unavailable`; action shows a retry message and keeps its command ID | no Account |
| Hebrew | any new screen | right-to-left, Hebrew copy | N/A |

</frozen-after-approval>

## Code Map

- `proxy.ts`, `lib/auth.ts`, `lib/auth-config.ts` -- email-list gate to replace with an Account-state decision; keep `hasSupabaseConfig` and the legacy-cookie cleanup.
- `app/auth/callback/route.ts` -- add `consumePreauthorization` after `exchangeCodeForSession`.
- `app/page.tsx`, `app/projects`, `app/progress`, `app/settings` -- pages call `getAccess()` and redirect when not active.
- `lib/sign-in.ts`, `lib/public-paths.ts`, `components/shell/routes.ts`, `components/login-form.tsx` -- add error codes (`account_disabled`), `/register` handling, chromeless route.
- `lib/accounts.ts` -- `registerWithCode`, `consumePreauthorization`, `accountStatus`, `clientAddressFromHeaders` (Part A, unchanged).
- `lib/i18n/en.ts`, `lib/i18n/he.ts` -- new keys; parity tests exist; Hebrew is machine-drafted and flagged.
- `lib/environment.ts`, `scripts/check-env.mjs`, `scripts/test-env.mjs`, `scripts/setup-env.mjs`, `.env*.example`, `docs/*.md`, `README.md`, `tests/**` -- every `AUTH_ALLOWED_EMAILS` reference.
- `tests/support/stack.ts`, `tests/e2e/`, `playwright.config.ts` -- stack helpers; e2e runs `npm run start` against the local stack.

## Tasks & Acceptance

**Execution:**
- [x] `lib/access.ts`, `lib/auth.ts` -- one Account-state resolver (`signed-out | unregistered | active | disabled | unavailable`) from the verified session and `accountStatus`, used by proxy, pages and callback; delete the email-list code -- AC-1, AC-9
- [x] `proxy.ts` -- apply the matrix; unregistered users reach only `/register`; any error denies -- AC-1, AC-9
- [x] `app/auth/callback/route.ts` -- consume the pre-authorization, then route by the resolved state, signing out on refusal, disabled or error -- AC-7
- [x] `app/register/page.tsx`, `app/register/actions.ts`, `components/register-form.tsx` -- Server Action with `useActionState`, command ID handling, generic messages, operator notice, "use a different Google account" sign-out; localized; phone and desktop -- AC-1, AC-3
- [x] `lib/i18n/en.ts`, `lib/i18n/he.ts`, `lib/sign-in.ts` -- messages and the `account_disabled` code -- AC-1
- [x] `components/shell/routes.ts`, `lib/public-paths.ts` -- `/register` chromeless and not public -- AC-1
- [x] `lib/environment.ts`, `scripts/*`, `.env*.example`, `docs/*`, `README.md` -- remove `AUTH_ALLOWED_EMAILS`; require both hash keys at startup outside previews -- AC-9
- [x] `tests/` -- unit (resolver, callback routing, action outcomes, proxy decisions with fake accounts), forged-session browser flows on desktop and phone in English and Hebrew (axe included), a test that searches the repository for the removed names -- all ACs
- [x] `deferred-work.md`, `docs/auth-setup.md` -- seed the old allowlist addresses before cutover, hosted steps for Josh -- housekeeping

**Acceptance Criteria:**
- Given a signed-in Google identity without an Account, when it visits any private path, then it reaches only `/register`, which explains the operator's role and works on phone and desktop in both languages.
- Given a valid unused code, when it is submitted, then one Account and Workspace exist and the user lands on Home; given an invalid, used, revoked or rate-limited code, then the failure is generic and a new attempt is possible.
- Given a pre-authorized address signing in for the first time, when the callback runs, then the Account is created and the Administrator's Google subject is pinned; another subject, or an unlisted identity, never gets one.
- Given a database failure in the proxy, a page or the callback, when access is decided, then access is denied.
- Given a disabled Account, when it signs in or navigates, then it is signed out and sees no private content.
- Given the repository, when searched, then `AUTH_ALLOWED_EMAILS` and the allowlist helpers appear nowhere, and a Google identity without a live Account is blocked from every private route.

## Spec Change Log

## Design Notes

Local Google sign-in cannot be driven, so browser tests forge sessions: insert a Google user and an `auth.sessions` row, sign an HS256 access token with the local JWT secret including `session_id`, and set the `@supabase/ssr` chunked cookie (`sb-<host-first-label>-auth-token`, `base64-` plus base64url JSON). GoTrue still validates the token, so the real `getUser()` path runs. The callback decision is a pure function over (user, receipts) so it is unit-tested without Google. The proxy adds one Auth call and one service-role call per private request; Story 1.4 replaces this with session grants. Hosted staging also needs the old allowlist addresses seeded, the two keys set and Google credentials before this ships there.

## Verification

**Commands:**
- `npm run typecheck && npm run lint && npm run build` -- expected: exit 0
- `supabase start && npm test` -- expected: unit and integration pass
- `CI=1 npm run test:e2e` -- expected: registration and gating flows pass on both projects
- `grep -rIn "AUTH_ALLOWED_EMAILS\|allowedEmail\|authAllowedEmails" . --exclude-dir=node_modules --exclude-dir=.git --exclude-dir=.next --exclude-dir=_bmad-output --exclude-dir=_bmad` -- expected: no matches

## Suggested Review Order

**One decision about who is in (the core idea)**

- A single resolver turns the verified session plus the Accounts database into one of five states; any failure becomes "unavailable".
  [`access.ts:144`](../../lib/access.ts#L144)

- The table that says where each state may go.
  [`access.ts:183`](../../lib/access.ts#L183)

- Only a real Google, confirmed, non-anonymous user counts; other Auth errors are outages, not "signed out".
  [`access.ts:111`](../../lib/access.ts#L111)

**Every request passes through it**

- The proxy applies the table to every private path and denies on any error.
  [`proxy.ts:39`](../../proxy.ts#L39)

- A seeded address is activated when its owner opens the registration page, not just at sign-in.
  [`access.ts:246`](../../lib/access.ts#L246)

- Pages repeat the check, so the proxy is not the only boundary.
  [`auth.ts:22`](../../lib/auth.ts#L22)

**Sign-in and sign-out**

- The callback claims a pre-authorization, then routes by the result; a refusal signs out everywhere, an outage only here.
  [`route.ts:14`](../../app/auth/callback/route.ts#L14)

- The sign-in decision for each outcome.
  [`access.ts:223`](../../lib/access.ts#L223)

- Sign-out has a deadline and only clears this project's cookies.
  [`sign-out.ts:32`](../../lib/supabase/sign-out.ts#L32)

**Registration screen**

- The Server Action: user from the session, bounded input, generic failures, command-ID handling.
  [`actions.ts:22`](../../app/register/actions.ts#L22)

- The form: operator notice, accessible errors, and a stale form is sent to the right page.
  [`register-form.tsx:80`](../../components/register-form.tsx#L80)

**Old list removed, new keys required**

- Hosted preflight: the accounts API must answer before a deploy proceeds.
  [`environment.ts:268`](../../lib/environment.ts#L268)

- A repository search proves the old email list is gone.
  [`allowlist-removal.test.ts`](../../tests/unit/allowlist-removal.test.ts)

**Tests (supporting)**

- Sessions are forged against the real local Auth, so the real `getUser()` path runs.
  [`forged-session.ts`](../../tests/support/forged-session.ts)

- Browser flows for every matrix row, desktop and phone, English and Hebrew, with accessibility checks.
  [`registration.spec.ts`](../../tests/e2e/registration.spec.ts)

- Proxy decisions and the callback, with fake Auth and fake accounts.
  [`proxy-gating.test.ts`](../../tests/unit/proxy-gating.test.ts)
