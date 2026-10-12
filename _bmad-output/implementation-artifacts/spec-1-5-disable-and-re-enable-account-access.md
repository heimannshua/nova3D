---
title: 'Story 1.5: Disable and re-enable account access'
type: 'feature'
created: '2026-10-12'
status: 'review'
baseline_commit: 'e07123726237f80c5d0db2f33f804dede5983990'
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-1-context.md'
  - '{project-root}/_bmad-output/implementation-artifacts/spec-1-4a-session-grants.md'
  - '{project-root}/_bmad-output/implementation-artifacts/spec-1-11-manage-invitations-with-fresh-authentication.md'
  - '{project-root}/_bmad-output/specs/spec-nova3D-story-1-5/acceptance-criteria.md'
  - '{project-root}/_bmad-output/specs/spec-nova3D-story-1-5/implementation-constraints.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** The Administrator cannot see the Accounts or turn one off. Nothing ends a person's sessions when they should lose access, and no check exists that a long-running operation must pass before it publishes or takes an external step.

**Approach:** An Administrator-only Accounts page (AD-02) lists the Accounts and disables or re-enables a member. Disabling revokes the Account's authority in one database transaction, audited, keeping its Workspace; only afterwards do cancellation signals go out. The story also defines the authority check every future Job and file path must pass.

## Boundaries & Constraints

**Always:** Consult `node_modules/next/dist/docs/` before writing Next.js code (AGENTS.md). `/admin/accounts` is for an active Administrator (`requireAdministrator`; anyone else gets a 404). `/admin` becomes the Administration index (links to Invitation codes and Accounts) and is where the `administration` step-up returns, because the return path comes from the class alone and one class serves both pages; Settings' Administration section links to `/admin`, Back from `/admin` goes to Settings and from its pages to `/admin`. The list shows, per Account, the verified Google address, the invitation's name (or "general code"), role, status as words and shapes (Enabled, Disabled) and creation time, and never Workspace content, project names or usage. Two Server Actions (disable, re-enable) run behind `withActiveAccount`, as Story 1.11's do, in this order: role is `administrator`; `checkMarker` for `administration` (only `allowed` passes: no marker, an expired one, or a marker of another class is a refusal that offers the step-up); then one database function with actor `user:<Auth user ID>` from the verified session, never from input. Disable is one transaction under a lock on the Account: status, the authorization epoch (the status change raises it, `identity.guard_account`), every session grant revoked, its Auth sessions ended, and the audit event `account.disabled` (actor, opaque `account:<id>` target, time); the Workspace is untouched. Only after it commits do cancellation signals go out: cancellers registered by later stories, run best-effort and counted, none exist yet. Re-enable sets the Account active under a newer epoch with `account.enabled`; revoked sessions stay revoked and the person signs in anew. An Administrator's Account cannot be disabled. The authority contract: `identity.assert_operation_authority(account, epoch)` for SQL that publishes (takes the Account row FOR SHARE so a disable cannot commit between check and write; raises when the Account is disabled or its epoch is newer than the one the operation registered under) and `api.guard_operation` for the application's own steps (allowed, disabled, stale_epoch or no_account; unreachable means denied), with a TypeScript module and a short document telling Jobs and the file gateway to use them. Refused attempts are audited by a new service-role-only function in the pattern of `api.record_invitation_refusal` (`account.disable_refused`, `account.enable_refused`, `account.denied`; actor and the Account as target when it exists; once an hour per actor, action and target; never a reason). Disable and re-enable ask in a dialog that starts on Cancel; the page shows Enabled, Disabling, Disabled, Re-enabled and the count of Jobs cancelled. `api.preflight` probes the new functions and the privilege to end Auth sessions. `stepUp.reason.administration` says it covers invitation codes and Accounts. English and Hebrew (right to left), light and dark, phone and desktop, WCAG 2.2 AA; new Hebrew is machine-drafted and flagged for native review. A provisioning-ledger attestation, due at this story, asks Josh to disable and re-enable a test Account on staging.

**Ask First:** Any change to what `api.revoke_grants`, `api.raise_authorization_epoch` or `identity.guard_account` do; new step-up classes; new environment variables or secrets; any step against staging or production.

**Never:** Deleting an Account, Workspace or any Workspace content; showing or reading Workspace content, project names or usage; impersonation or granting administrators; disabling the Administrator (recovery is Story 1.6); download authority (Story 1.12) or real Jobs, beyond the contract; Account deletion (Story 8.2); a marker check only in the browser; email to the person; deleting or editing audit rows.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Disable | Administrator, valid marker, enabled member with live sessions | Disabled in one step: epoch raised, grants revoked, Auth sessions ended, Workspace kept, `account.disabled`; cancellers run after commit; notice gives sessions ended and Jobs cancelled | N/A |
| Disabled person's browsers | any of its old sessions, next request | refused at once and signed out with the disabled message | N/A |
| Late operation | registered under the old epoch, tries to publish or take an external step | guard denies, also after re-enable (its epoch is stale); SQL check raises and nothing is written | a disable racing a publication: one wins cleanly |
| Re-enable | disabled member, valid marker | active under a newer epoch; old sessions stay revoked; person signs in anew; `account.enabled` | already enabled: told, nothing changes |
| No valid marker | disable or re-enable with none, an expired one, or only another class's | nothing changes; step-up offered; `account.*_refused` audited | N/A |
| Not an Administrator | open page, or call an action | 404; action denied, `account.denied` audited, nothing changes | N/A |
| The Administrator's Account | disable | refused, nothing changes | N/A |
| Unknown Account ID | disable or re-enable | not found | N/A |
| Two windows | disable at once | one disables, the other is told it is already disabled | N/A |
| Database unreachable | any action | retryable notice, nothing changed | outcome unknown: told to check the list first |
| Privacy | page, logs, audit rows | no Workspace content; audit holds actor, action, opaque target, time | N/A |

</frozen-after-approval>

## Code Map

- `supabase/migrations/20261010130000_session_grants.sql` -- `identity.guard_account` (:36, a status change raises the epoch and audits `account.epoch_raised`), `api.revoke_grants` (:308, by Account; final; audits `session.revoked`), `api.raise_authorization_epoch` (:383), `api.authorize_session` (answers `disabled` before any grant). `20261011140000_account_preferences.sql` -- current `api.authorize_session` (:180) and `api.preflight` (:260): replace the latter. `20261010120000_accounts.sql` -- `identity.accounts` (status, role), `identity.record_audit` (:230) and `record_audit_once` (:241). Pattern to copy: `20261012120000_invitation_refusals.sql` (service-role only, advisory lock, hourly dedupe, validated kind). New migration: `*_account_administration.sql`.
- `lib/accounts.ts` -- typed calls: `revokeAccountGrants` (:636), `checkMarker` (:770), `recordInvitationRefusal` (:898), `listInvitations` (:916); add list, disable, enable, guard, `recordAccountRefusal`. `lib/auth.ts` -- `requireAdministrator` (:68), `withActiveAccount`. `app/admin/invitations/actions.ts` -- `administered` (:81): the role, marker, change wrapper; share it rather than copy it, and update the structural tests that read it. `app/admin/invitations/page.tsx`, `components/admin/*`, `components/use-invitation-action.ts` -- patterns for page, list, dialog, double-submit guard.
- `lib/step-up.ts` -- `stepUpReturnPaths` (:31); `lib/access.ts` (:568) uses it after a step-up; `components/shell/routes.ts` -- `parentRoute` (:24); `components/settings/administration-section.tsx`; `lib/i18n/{en,he}.ts` (`stepUp.reason.*`, `settings.admin.*`).
- `lib/access.ts` (:418-480) -- a disabled Account is already signed out everywhere at its next request (`account_disabled`); do not duplicate it.
- `tests/unit/gate-structure.test.ts`, `tests/unit/page-guards.test.ts`, `tests/support/forged-session.ts` (`setStatus`, `makeAdministrator`, `forgeMarker`, `workspacesOf`), `tests/integration/session-grants.test.ts` ("re-enabling is Story 1.5's"), `tests/e2e/invitations.spec.ts` and `step-up.spec.ts` (return to `/admin/invitations` becomes `/admin`).
- `provisioning/ledger.json`, `docs/provisioning.md` (generated: `npm run render:provisioning`), `docs/auth-setup.md`, `docs/staging.md` (must name the new migration), `README.md`, `deferred-work.md` entries mapped to 1.5.

## Tasks & Acceptance

**Execution:**
- [x] `supabase/migrations/*_account_administration.sql`, `lib/accounts.ts`, `lib/authority.ts` -- list, disable, enable, guard and SQL assert, refusal recording, preflight probes, typed calls, the cancellation registry -- AC-1, AC-2, AC-3, AC-4
- [x] `app/admin/page.tsx`, `app/admin/accounts/{page,actions}`, `components/admin/*`, shared role-marker-change wrapper, `components/settings/administration-section.tsx`, `components/shell/routes.ts`, `lib/step-up.ts`, `lib/i18n/{en,he}.ts` -- the index, the Accounts page, two actions, return path, Back target, wording -- AC-3, AC-4
- [x] `tests/` -- every matrix row: unit (actions with faked calls: role, each marker outcome incl. another class, order, cancellers run after the commit and see the guard already denying), integration (disable atomic and complete, Workspace kept, administrator refused, re-enable, idempotence, guard states, SQL assert with a racing disable on two connections, refusal function closed and deduplicated, preflight), browser on desktop and phone (list, disable, the disabled person's browser refused at once, re-enable and a real new sign-in, refusal and step-up offered, non-Administrator, two windows, outage, axe in four variants, 320 px at 200% text, keyboard and dialog focus); update structural tests -- all ACs
- [x] `provisioning/ledger.json`, `docs/{provisioning,auth-setup,staging}.md`, a short authority-contract document, `README.md`, `deferred-work.md` -- the attestation, a hosted check, resolved and remaining entries -- housekeeping

**Acceptance Criteria:**
- Given an enabled member with live sessions, when a freshly authenticated Administrator disables it, then its sessions, epoch and (later) download authority end atomically before any cancellation signal, and its Workspace remains.
- Given an operation registered under a revoked epoch, when it tries to publish or take an external step, then the guard denies it, and the audit trail shows the transition without private contents.
- Given a disabled Account, when it is re-enabled, then new authentication regains access under a newer epoch, earlier sessions stay revoked, and the list and its controls work on phone and desktop.
- Given a disable or re-enable without a valid administration marker (none, expired or another class), when submitted, then it is refused with the step-up offered; with one it succeeds and appends an immutable audit event.

## Spec Change Log

## Design Notes

Ending the Auth sessions inside the disable transaction (a delete on `auth.sessions` by the function's owner) keeps "revoke atomically" literal and is testable locally; the privilege is probed by `api.preflight`, so an environment that refuses it fails the build rather than half-disabling. The epoch is not raised by hand: the status change already raises it. A late operation is fenced by the epoch it registered under, so it stays denied after a re-enable. Cancellation never runs before the commit, so a canceller that checks the guard always finds it denying.

## Verification

**Commands:**
- `npm run typecheck && npm run lint && npm run build` -- expected: exit 0
- `supabase start && npm test` -- expected: unit and integration pass, every matrix row covered
- `CI=1 npm run test:e2e` (clean scratch copy, stack started as CI does, fake Google active) -- expected: all flows pass on both projects
- `node scripts/ci/check-repository.mjs && npm run render:provisioning -- --check && npm run test:env` -- expected: exit 0

**Manual checks (if no CLI):**
- Open the Accounts page as the Administrator on a phone-width window in Hebrew and dark: every state reads in words, and the dialog starts on Cancel.
