---
title: 'Story 1.6: Recover the sole Administrator securely'
type: 'feature'
created: '2026-10-12'
status: 'in-progress'
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-1-context.md'
  - '{project-root}/_bmad-output/implementation-artifacts/spec-1-4b-step-up.md'
  - '{project-root}/_bmad-output/implementation-artifacts/spec-1-5-disable-and-re-enable-account-access.md'
  - '{project-root}/_bmad-output/specs/spec-nova3D-story-1-6/acceptance-criteria.md'
  - '{project-root}/_bmad-output/specs/spec-nova3D-story-1-6/implementation-constraints.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** If the Administrator's Google sign-in is lost or failing, nothing lets them back in short of database access, and no non-Google path exists.

**Approach:** A public Recover page mints a single-use token and emails nova3D's own link to the configured Administrator address (Resend, `resend.dev` sender). A confirmation page POSTs it, the server mints a session through the Auth Admin API, and one database transaction ends every prior Administrator session, raises the epoch, grants the new session and gives it a fresh-authentication marker.

## Boundaries & Constraints

**Always:** Consult `node_modules/next/dist/docs/` before writing Next.js code (AGENTS.md).
- **Who is eligible:** the one Account with role `administrator` whose Auth user's email equals `ADMINISTRATOR_EMAIL`. The server passes that address to the database; no request supplies it. None, or a failed pinned-subject check, is refused and audited, and nothing is minted.
- **Token:** 32 random bytes, base64url. Only its HMAC-SHA-256 under `RECOVERY_HASH_KEY` is stored, in the closed table `identity.recovery_tokens` (issue, expiry, use and void times). Lifetime 15 minutes on the database clock; one outstanding; issuance limited globally to 1 per 15 minutes and 5 per day, every issuance counting (Spine). Every new database object is service-role only, executable by neither `anon` nor `authenticated`.
- **`/recover` (public):** one button, no input. `requestRecovery` issues, mails, and answers only sent, limited or unavailable, never an address, name or Workspace. No eligible Administrator and a mail failure both read unavailable; the audit holds the cause.
- **Mail:** only to `ADMINISTRATOR_EMAIL`, through `lib/mailer.ts`, where the recipient is not a parameter. Staging and production use Resend (`api.resend.com/emails`, `RESEND_API_KEY`); `APP_ENV=local` uses the stack's Mailpit over HTTP. Plain `fetch`, no SDK (the dependency set is pinned), a timeout, no redirects, nothing logged. The link is `<origin>/recover/confirm#<token>`: the token in the fragment, so no server, proxy, platform log, Referer or audit row sees it (NFR-2; `Referrer-Policy` stays as it is). `<origin>` is `APP_ORIGIN` (required in staging and production: an https origin); locally the request's origin.
- **`/recover/confirm` (public):** GET only renders, so a scanner's GET changes nothing and cannot see the token. The page moves the token out of the URL into a form; its button POSTs `redeemRecovery`. Order: check the token (read-only) → Auth Admin `generate_link` (magiclink, the Auth user's own email) → `verifyOtp` on the cookie-bound client → one database transaction → clear the CSRF cookie → go to `/admin`. Until that transaction commits, only an inert, grant-less Auth session can exist; a failure after `verifyOtp` ends it, and the token stays unused unless the transaction committed.
- **The transaction,** under a lock on the Account: re-checks the token (unused, unvoided, unexpired) and marks it used; raises the authorization epoch; revokes every grant of the Account (`api.revoke_grants`, reason `recovery`); deletes every other Auth session of the person; issues the new session's grant (`api.issue_grant`); writes the marker (class `administration`, five minutes, that session only, source `recovery`); audits `recovery.redeemed`. Any refusal rolls back all of it. The loser of a race ends only its own session.
- **Audit:** actor `system:recovery` or `user:<Auth user ID>`, opaque target `account:<id>`, never a token, hash, address or reason text. Events: `recovery.issued`, `recovery.limited`, `recovery.rejected.<unknown|used|expired|voided|administrator>`, `recovery.mail_failed`, `recovery.redeemed`. Refusals are recorded once an hour per actor, action and target.
- Recovery re-pins nothing: the new session works only if `api.issue_grant` accepts it (pinned Google subject). `api.preflight` probes the new table and functions. Pages: English and Hebrew (right to left), light and dark, phone and desktop, WCAG 2.2 AA; states are request sent, expired or used link, and success with sessions ended (UX-DR23); new Hebrew is machine-drafted and flagged for native review. The sign-in page gets a quiet link to `/recover`. A provisioning-ledger attestation, due at this story, asks Josh to run recovery on staging with the Email provider disabled, and to stop and record a design change if hosted Auth refuses the link API or `verifyOtp` (AC-4).

**Ask First:** Any change to what `api.revoke_grants`, `api.raise_authorization_epoch`, `identity.guard_account`, `api.complete_step_up` or `api.use_marker` do (making the marker's nonce optional and adding `source` is the only edit to the step-up table); new step-up classes; environment variables or secrets beyond `RECOVERY_HASH_KEY`, `RESEND_API_KEY` and `APP_ORIGIN`; any step against staging or production; hosted Auth refusing the Admin link API with the Email provider disabled (stop and record the design change).

**Never:** A recipient, link origin or Account chosen by a request; the token or its hash in a URL the server sees, a log, an audit row, a cookie or an error; a state change on GET; enabling the Email provider or any other sign-in credential; recovery for a member; a second Administrator, impersonation or Workspace access; re-pinning a Google subject (stays a database operation); a unique index on role; a real Resend call from any test; operational alarms (Story 1.13).

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Request | eligible Administrator, nothing issued within 15 minutes, fewer than 5 today | token issued, mail sent to the configured address only, page says sent | N/A |
| Limited | an issuance within 15 minutes, or 5 in 24 hours | page says try later; nothing issued or mailed; `recovery.limited` | N/A |
| Cannot send | no eligible Administrator, mailer refused, database down | page says unavailable; nothing usable remains (a definitive mail refusal voids the token) | outage: retryable |
| Scanner GET | the emailed link | page renders; the token is still valid; nothing changes | N/A |
| Redeem | valid token, POST | signed in as the Administrator at `/admin`; epoch raised; prior grants and Auth sessions gone; fresh marker; `recovery.redeemed` | N/A |
| Bad link | expired, used, replayed, voided or unknown token, POST | one message, no session, nothing changed, audited | N/A |
| Two windows | the same link at once | one recovers; the other is refused and its own session ended | N/A |
| Outage midway | database or Auth down | retryable; token unused unless the transaction committed; no session left | outcome unknown after the commit: told to open `/admin` |
| Subject mismatch | pinned subject differs from the Auth user's Google identity | refused, rolled back, audited | N/A |
| The marker | the new session | `administration` allowed for five minutes; other classes and other sessions none | N/A |
| Privacy | pages, mail, logs, audit | no Workspace content; the token only inside the link | N/A |

</frozen-after-approval>

## Code Map

- `supabase/migrations/20261011120000_step_up.sql` -- `identity.fresh_authentications` (:92: `nonce_id` not null, to become nullable beside a `source` column), `identity.guard_fresh_authentication` (:118, compares `nonce_id` with `<>`), `api.complete_step_up` (:248, needs an `oauth` AMR, so recovery cannot reuse it), `api.use_marker` (:362). New migration: `*_administrator_recovery.sql`.
- `20261010130000_session_grants.sql` -- `api.issue_grant` (:144: active Account, an `auth.sessions` row, `identity.subject_pinned` :113), `api.revoke_grants` (:308; `recovery` is an anticipated reason), `api.raise_authorization_epoch` (:383; raise before issuing the new grant or it is stale). `20261012130000_account_administration.sql` -- `api.disable_account` (:89, lock then revoke then `delete from auth.sessions`), `api.record_account_refusal` (:270, advisory lock and hourly dedupe), `api.preflight` (:319, latest: carry every probe forward). `20261010120000_accounts.sql` -- `identity.record_audit` (:230), `record_audit_once` (:241), audit constraints (:203).
- `lib/accounts.ts` -- `callApi` (:317), `callRow`, `issueGrant` (:490), `hashKey` (:97), `AccountsUnavailableError` (:186); `lib/environment.ts` -- `hashKeyVariables` (:41), `previewForbiddenName` (:28), `validateEnvironment` (:129). `lib/access.ts` -- `readUser` (:202), `sessionIdOfToken` (:180), `ineligibleReason` (:154); `app/auth/callback/route.ts` -- the sign-in sequence to mirror (exchange :49, `clearCsrfCookie` :67, `readUser` :70, fail-closed `endSession`).
- `lib/step-up.server.ts` -- `requestOrigin` (:87); `app/step-up/page.tsx` and `components/step-up-form.tsx` (:56-107) -- the nearest signed-out form (`useActionState`, ref lock, `pageshow`); `components/use-account-action.ts`; `lib/i18n/{en,he}.ts` (`MessageKey`, no Latin words in Hebrew).
- `lib/public-paths.ts` (:4), `components/shell/routes.ts` (`isChromeless` :10), `proxy.ts` (:149 public paths still get the Origin check), `tests/unit/{proxy,page-guards,gate-structure,shell,metadata,i18n,environment,startup,setup-env,provisioning,staging-guide,playwright-config,repository-contract}.test.ts`. A signed-out route uses Server Actions in `app/**/actions.ts`; a POST `route.ts` would fail the gate.
- `tests/support/` -- `forged-session.ts` (`makeAdministrator` :236), `accounts-data.ts` (`insertAuthUser`, `insertAuthSession`, `removeAccountData` must clear the new table first), `e2e-helpers.ts`, `server-env.ts`; `playwright.config.ts` (`webServer.env`); new `tests/support/mail.ts` over Mailpit's API (`GET /api/v1/messages`, `/message/<id>`, `DELETE /api/v1/messages`).
- `provisioning/ledger.json` (`resend-account` :311, `resend-api-key` :326, `resend-api-key-production` :340, all due 1-6), `docs/{auth-setup,staging,secrets,deployment-setup,provisioning}.md` (provisioning is generated: `npm run render:provisioning`), `README.md`, `deferred-work.md` entries mapped to 1.6.

## Tasks & Acceptance

**Execution:**
- [ ] `supabase/migrations/*_administrator_recovery.sql`, `lib/accounts.ts`, `lib/recovery.ts` -- the table; issue, void, check and redeem functions; nullable nonce and `source` on the marker; preflight probes; hashing and typed calls -- AC-1, AC-2, AC-3
- [ ] `lib/mailer.ts`, `lib/auth-admin.ts`, `lib/environment.ts`, the three `.env*.example`, `scripts/{setup-env,test-env}.mjs` -- the mailer and Admin API client; `RECOVERY_HASH_KEY`, `RESEND_API_KEY`, `APP_ORIGIN` in the contract (previews forbid the first two) -- AC-1, AC-4
- [ ] `app/recover/{page,actions}`, `app/recover/confirm/page`, `components/`, `lib/public-paths.ts`, `components/shell/routes.ts`, the sign-in link, `lib/i18n/{en,he}.ts` -- both pages, two actions, wording -- AC-1, AC-2, AC-3
- [ ] `tests/` -- every matrix row: unit (mailer on both transports with faked `fetch`, recipient and token placement, action order and failures, no token in any log), integration (issue and both limits, eligibility, check states, the transaction's effects and rollback, a race on two connections, marker use, closure, preflight), browser (desktop: request, mail from Mailpit, scanner GET, redeem, old session gone, marker works, replay, expiry, limit, two windows, axe in four variants, 320 px at 200% text, keyboard focus; phone: render, axe, overflow); update the structural tests -- all ACs
- [ ] `provisioning/ledger.json`, `docs/*`, `README.md`, `deferred-work.md` -- the attestation, a hosted check, resolved and remaining entries -- housekeeping

**Acceptance Criteria:**
- Given the configured sole Administrator, when recovery is requested, then only the verified email receives the protected link, the response exposes nothing of other Workspaces, and both pages work on phone and desktop.
- Given an expired, used or replayed link, when redemption is attempted, including a mail scanner's GET, then access is denied without partial recovery.
- Given a valid recovery link, when redemption succeeds, then all prior Administrator sessions are revoked, the new session holds a fresh-authentication marker, and an immutable recovery audit event is recorded.
- Given the staging project with the Email provider disabled, when a recovery link is redeemed, then the Admin API mints a session that holds a fresh-authentication marker for that session only, or the story stops with a recorded design change.

## Spec Change Log

## Design Notes

Why the fragment: a query string reaches Vercel's request logs and a `Referrer-Policy: no-referrer` header is forbidden by `request-integrity.spec.ts`, so the fragment is the only place the token never leaves the browser until the POST. Why validate, mint, then commit: burning the token before the mint would lock the Administrator out for 15 minutes after any outage, while an inert session has no grant and cannot reach a private path. Why the Account is found by the configured address: a unique Auth email makes "the sole Administrator" decidable here without a unique index (deferred since Story 1.3), and keeps the tests apart from a developer's real Administrator. Local mail: Mailpit (v1.31.3 here) sends, lists and deletes over HTTP and CI starts it, so the app and the tests share one real path and the Resend transport is covered by unit tests and the staging attestation.

Verified on the local stack (Email provider off, Google only, 2026-10-12): `generate_link` then `verify` returns a session; for a user that has a Google identity `app_metadata` stays `google`, the session's `amr` is `otp`, a replayed token gives `otp_expired`, and the new session still works after the others are deleted. A user with no identity row came back as `email`, so tests use real identity rows. Hosted Auth is unverified (AC-4).

Recovery is a global singleton: one outstanding token and a global limit. So the browser flows live in one serial spec on the desktop project, the server's `ADMINISTRATOR_EMAIL` is overridden in `playwright.config.ts` to a test address, and only that spec and one integration file touch `identity.recovery_tokens`, each clearing it between cases.

## Verification

**Commands:**
- `npm run typecheck && npm run lint && npm run build` -- expected: exit 0
- `supabase start && npm test` -- expected: unit and integration pass, every matrix row covered
- `CI=1 npm run test:e2e` (stack started as CI does, fake Google active, `.env.local` from `scripts/setup-env.mjs local`) -- expected: all flows pass on both projects
- `node scripts/ci/check-repository.mjs && npm run render:provisioning -- --check && npm run test:env` -- expected: exit 0

**Manual checks (if no CLI):**
- Open `/recover` and the confirmation page on a phone-width window in Hebrew and dark: every state reads in words and the button is reachable by keyboard.
