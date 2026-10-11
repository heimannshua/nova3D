---
title: 'Story 1.4d: Account preferences, the isolation proof, the staging guide and signed-in shell coverage'
type: 'feature'
created: '2026-10-11'
status: 'done'
baseline_commit: '9ca8e71c40241c967d4e22a08a7db39e09d7160d'
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-1-context.md'
  - '{project-root}/_bmad-output/implementation-artifacts/spec-1-4a-session-grants.md'
  - '{project-root}/_bmad-output/implementation-artifacts/spec-1-4c-request-integrity.md'
  - '{project-root}/_bmad-output/specs/spec-nova3D-story-1-4/acceptance-criteria.md'
  - '{project-root}/_bmad-output/specs/spec-nova3D-story-1-4/implementation-constraints.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Language, light or dark, explanation detail and first-use guidance live only in four device cookies, so they do not belong to the Account or follow it, and the sign-in page offers no choice. Nothing yet proves, with two Accounts, that one cannot reach the other's data; the signed-in shell is tested only through the synthetic kit; and staging is pushed by hand with no written procedure.

**Approach:** An Account-owned preferences record, returned by the live authorization on every request, wins whenever the Account has one; a person's first sign-in adopts the device cookies into it. A two-Account isolation suite, `docs/staging.md`, and browser coverage of the real signed-in shell finish Story 1.4.

## Boundaries & Constraints

**Always:** Consult `node_modules/next/dist/docs/` before writing Next.js code (AGENTS.md). Table `identity.account_preferences`: one row per Account (`account_id` primary key, `ON DELETE RESTRICT`), `locale` (null follows the device, else `en` or `he`), `theme`, `detail`, `guidance`, `created_at`, `updated_at`; CHECK constraints equal the allowed values in `lib/preferences.ts` (a test keeps them in step); RLS on, no policy, no privilege for `anon` or `authenticated`. New `api` functions are service-role only and take the Account ID the server derived, never a client's: `api.adopt_preferences` inserts only when no row exists (`created`, `exists` or `denied`), `api.set_preference` validates one name and value and saves it (`saved` or `denied`), and both refuse an Account that is not active. `api.authorize_session` returns the record, or null, in its active answer through one extra primary-key read and no extra round trip; `api.preflight` probes the table. Adoption: on an authorized document navigation whose active answer has no record, the proxy adopts the valid device cookies (an absent or tampered cookie is a default, locale null); a failure is logged and never blocks the page. The record wins: for an active Account with one, the layout, metadata and `getI18n` render from it; cookies serve pages with no Account (sign-in, kit) and are the copy a change writes. A change made signed in goes through a Server Action behind `withActiveAccount` that saves the record and sets the cookie copy; the client applies it at once, undoes it and announces if the save fails, and refreshes on success. Signed out, choices stay cookie-only as today. The sign-in page offers English or Hebrew and light or dark (cookies only; announced; phone, desktop, right to left, axe in all four variants). The isolation suite exercises two real Accounts through REST, direct database roles, the `api` functions with the other Account's IDs, a private storage bucket, and composite ownership foreign keys, and checks table by table that everything in `identity`, `projects` and `lifecycle` is closed to `anon` and `authenticated`, failing for a table added later that is not. `docs/staging.md` covers pushing config and migrations by hand until Story 1.9, and a test keeps it naming every migration. New Hebrew is machine-drafted and flagged.

**Ask First:** New environment variables, secrets or dependencies (including the `server-only` package); changing which schemas are exposed; any step against staging or production.

**Never:** Redis, cookies or JWT claims as the store; live cross-device sync or polling; changes to how grants, step-up or CSRF work (beyond the extra answer field); showing the signed-in person in the Account menu; Projects, Sources or other domain tables (the suite proves the ownership pattern on scratch tables); applying anything to staging or production; secrets in docs; presenting Hebrew as reviewed.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| First sign-in, device chose Hebrew and dark | no record, cookies set | record created with them; follows the Account | adopt fails: page uses cookies, retried on the next navigation |
| First sign-in, no cookies | no record | locale null, light, simple, shown | N/A |
| Tampered cookie | invalid value | treated as absent | N/A |
| New device | record exists, other cookies | pages render the record; cookies untouched | N/A |
| Change while signed in | any of the four | record saved, cookie set, UI updated, announced | save fails: undone, announced, nothing stored |
| "Match my device" | signed in | locale null; follows Accept-Language | as above |
| Cookies refused | signed in | still saved | N/A |
| Two first requests at once | no record | one record, first wins | N/A |
| Choice on sign-in page | signed out | cookie only; adopted at first sign-in, ignored once a record exists | N/A |
| Other Account's ID, row, session or object | any path | no data, no change | refused |
| Cross-Workspace reference | composite FK | rejected | N/A |
| Table added later without closure | any role | suite fails | N/A |

</frozen-after-approval>

## Code Map

- `supabase/migrations/20261010130000_session_grants.sql` -- `api.session_authorization` (:128), `api.authorize_session` (:223): add an attribute and one read in the active branch. `20261011130000_request_integrity.sql` -- latest `api.preflight` (:167). New migration `20261011140000_account_preferences.sql` follows these patterns (default privileges, grants by name, `notify pgrst`).
- `lib/preferences.ts` -- allowed values, cookie names, parse and serialize; `lib/preferences.server.ts` -- `getRequestPreferences` (:14), used by `app/layout.tsx` (:16, :27) and `lib/i18n/server.ts`; `lib/auth.ts` -- `getAccess` (:45, per-render cache), `withActiveAccount` (:162).
- `lib/accounts.ts` -- `SessionAuthorization` (:245), `authorizeSession` (:463), `callRow`; `lib/access.ts` -- `AccessAccount` (:63), `resolveAccess` (:246); `proxy.ts` -- `pageCsrfCookie` (:90) and the allowed branch of `proxy` (:124) are where adoption goes.
- `components/preferences-provider.tsx` (sync `setPreference`/`setLocale`), `components/settings/preferences-form.tsx`, `components/ui/guidance-card.tsx` (`dismissGuidance`), `components/login-form.tsx`, `app/account/actions.ts` (Server Action pattern), `lib/i18n/{en,he}.ts` (`settings.lede` says "kept on this device").
- `tests/unit/{preferences-provider,shell,access,proxy-gating,gate-structure,repository-contract}.test.ts*`; `tests/integration/accounts.test.ts` (:89 closure of every table, :192, :263 REST) -- extend, do not duplicate; `tests/support/accounts-data.ts` (`removeAccountData` :92 must delete the new table first), `forged-session.ts`, `e2e-helpers.ts`; `tests/e2e/shell.spec.ts` (kit-based), `registration.spec.ts` (:476 real routes, English light and Hebrew dark only), `authorization.spec.ts`; `tests/support/fake-network.mjs` (attributes calls to users).
- `docs/deployment-setup.md` ("Provisioning staging"), `docs/auth-setup.md` ("Staging and production", cutovers), `docs/provisioning.md` (Story 1.4 ledger ids), `supabase/config.toml`, `README.md` (interface row), `deferred-work.md` (entries to resolve).

## Tasks & Acceptance

**Execution:**
- [x] `supabase/migrations/20261011140000_account_preferences.sql` -- table, `api.adopt_preferences`, `api.set_preference`, extended `api.authorize_session` and `api.preflight` -- AC-7
- [x] `lib/accounts.ts`, `lib/access.ts`, `lib/auth.ts`, `lib/preferences.server.ts`, `proxy.ts` -- typed calls, the record carried in `AccessAccount`, effective preferences, adoption -- AC-7
- [x] `app/account/actions.ts` (or a sibling), `components/preferences-provider.tsx`, `preferences-form.tsx`, `guidance-card.tsx`, `app/layout.tsx` -- persisted change with undo on failure, a small notice component that announces a failed save, account wording for Settings -- AC-7
- [x] `components/login-form.tsx` (or a child), `lib/i18n/{en,he}.ts` -- language and theme choice on the sign-in page; new strings -- AC-7
- [x] `tests/integration/isolation.test.ts` -- two Accounts over REST, database roles, `api` functions, storage bucket, composite references, table-by-table closure with a forward guard -- AC-1
- [x] `docs/staging.md` and a unit test that it names every migration; link from `deployment-setup.md` and `auth-setup.md` -- manual push procedure
- [x] `tests/e2e/signed-in-shell.spec.ts` (shared helpers move to `e2e-helpers.ts`), `tests/e2e/preferences.spec.ts` -- real routes and the 404 page: keyboard, menus and dialogs, enlarged text, high contrast, axe in four variants, on both projects; first sign-in, new device, change from another device, sign-in page choice -- AC-1, AC-7
- [x] Unit tests for every matrix row; `lib/accounts.ts` keeps its guard by test, with its header note and the deferred entry updated (no `server-only` package); `README.md`, `docs/auth-setup.md`, `deferred-work.md` -- housekeeping

**Acceptance Criteria:**
- Given preferences chosen on a device before sign-in, when an Account first signs in, then they become its stored preferences and a new device renders them after sign-in (AC-7).
- Given two Accounts with private records, when one tries the other through APIs, direct database roles, `api` functions and storage identifiers, then nothing is disclosed or changed and no cross-Workspace reference can be created (AC-1).
- Given a table added to `identity`, `projects` or `lifecycle` that `anon` or `authenticated` can touch, when the suite runs, then it fails.
- Given the real signed-in routes, when the browser suite runs, then keyboard, menus, 404, enlarged text, high contrast and axe pass on phone and desktop.

## Spec Change Log

## Design Notes

Why the record rides on `authorize_session`: the gate already makes that call twice per page, so the record costs a primary-key read, not a round trip, and cannot disagree with the Account being authorized. Why the layout renders from it instead of rewriting cookies in the proxy: a cross-device change shows on the next navigation with no cookie plumbing, and cookies stay only the copy that serves pages with no Account. The layout asks `getAccess()` only when the request carries an Auth session cookie, so the sign-in page and the kit cost nothing signed out; an unavailable or non-active answer falls back to the cookies. Adoption in the proxy covers every first session that ends in a full page load (the callback claim, the `/register` claim), as the CSRF issue does; the registration form's landing is a Server Action redirect, which the browser follows as a client-side navigation, so that Account adopts at its next full page load (recorded in `deferred-work.md`). A shared device means a new Account's first sign-in adopts whatever the last person left in the cookies; they are not sensitive and the person can change them. Storage: Supabase ships no policy on `storage.objects`, so browsers are denied by default; the suite pins that no policy exists and that a private bucket's objects stay unreachable, which Story 1.12's gateway builds on.

## Verification

**Commands:**
- `npm run typecheck && npm run lint && npm run build` -- expected: exit 0
- `supabase start && npm test` -- expected: unit and integration pass, every matrix row covered
- `CI=1 npm run test:e2e` (clean scratch copy, stack started as CI does, fake Google active) -- expected: all flows pass on both projects
- `node scripts/ci/check-repository.mjs && npm run render:provisioning -- --check && npm run test:env` -- expected: exit 0

**Manual checks (if no CLI):**
- Read `docs/staging.md` as Josh on Windows: every command works in PowerShell, nothing assumes a bash shell, nothing is applied by the build.

## Suggested Review Order

**The record and how it reaches a request**

- The table: one row per Account, CHECK constraints equal to the allowed values, closed to every browser role.
  [`account_preferences.sql:33`](../../supabase/migrations/20261011140000_account_preferences.sql#L33)

- Adoption inserts only when there is no record; saving validates one name and value and refuses an inactive Account.
  [`account_preferences.sql:87`](../../supabase/migrations/20261011140000_account_preferences.sql#L87)

- The live authorization carries the record in its active answer: one primary-key read, no extra round trip.
  [`account_preferences.sql:247`](../../supabase/migrations/20261011140000_account_preferences.sql#L247)

- A first sign-in adopts the device's valid cookies in the proxy, on a full page load, and never blocks the page.
  [`proxy.ts:113`](../../proxy.ts#L113)

- The record wins for an active Account; every other state, or a failed read, falls back to the cookies.
  [`preferences.server.ts:30`](../../lib/preferences.server.ts#L30)

**Changing a preference while signed in**

- One Server Action: verified Account, validated name and value, record first, cookie copy only after it is saved.
  [`preference-actions.ts:62`](../../app/account/preference-actions.ts#L62)

- Saves run in order, a throw or a hang never wedges the queue, and a redirect counts as ended.
  [`preference-actions.ts:83`](../../lib/preference-actions.ts#L83)

- The provider applies a choice at once, undoes it if the save fails, and holds back a render older than the choices on screen.
  [`preferences-provider.tsx:119`](../../components/preferences-provider.tsx#L119)

- The failed-save notice: announced once per failure, in the shell and on the screens without one.
  [`preference-notice.tsx:40`](../../components/ui/preference-notice.tsx#L40)

- The sign-in page offers language and light or dark as radio groups, so it still has one button.
  [`login-preferences.tsx:26`](../../components/login-preferences.tsx#L26)

**The isolation proof**

- Two real Accounts, then every path: REST, database roles, `api` functions with the other Account's IDs.
  [`isolation.test.ts:133`](../../tests/integration/isolation.test.ts#L133)

- A private bucket stays unreachable to the other Account, and no storage policy exists to open it.
  [`isolation.test.ts:366`](../../tests/integration/isolation.test.ts#L366)

- Composite foreign keys keep a reference inside one Workspace (scratch tables, rolled back).
  [`isolation.test.ts:496`](../../tests/integration/isolation.test.ts#L496)

- Catalog-driven closure of every Identity, Projects and Lifecycle table, with a forward guard shown to fail.
  [`isolation.test.ts:698`](../../tests/integration/isolation.test.ts#L698)

**Staging guide and the signed-in shell**

- The manual push procedure: link, migrations, Auth settings from a scratch copy, seed, deploy, verify.
  [`staging.md:45`](../../docs/staging.md#L45)

- The real routes and the 404 page behind a forged session: axe in four variants, keyboard, text size, contrast.
  [`signed-in-shell.spec.ts:59`](../../tests/e2e/signed-in-shell.spec.ts#L59)

- A defect the kit could not show: the search field pushed My Projects sideways at 200% text on a phone.
  [`globals.css:703`](../../app/globals.css#L703)

**Docs and tests (supporting)**

- What the record is, how it is adopted, and what the isolation suite proves.
  [`auth-setup.md:156`](../../docs/auth-setup.md#L156)

- The rule that a stale server render never undoes a later choice, as a pure function with tests that can fail.
  [`preferences.ts:177`](../../lib/preferences.ts#L177)
