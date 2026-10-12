---
title: 'Story 1.11: Manage invitations with fresh authentication'
type: 'feature'
created: '2026-10-12'
status: 'ready-for-dev'
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-1-context.md'
  - '{project-root}/_bmad-output/implementation-artifacts/spec-1-4b-step-up.md'
  - '{project-root}/_bmad-output/implementation-artifacts/spec-1-4d-preferences-isolation-staging.md'
  - '{project-root}/_bmad-output/specs/spec-nova3D-story-1-11/acceptance-criteria.md'
  - '{project-root}/_bmad-output/specs/spec-nova3D-story-1-11/implementation-constraints.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** The Administrator can issue and revoke invitation codes only from a command-line seed script. There is no page, no fresh-authentication check, and nothing yet sends anyone to the step-up that Story 1.4b built. Refused attempts are not audited.

**Approach:** An Administrator-only page (AD-01) lists the codes and issues named codes, revokes unused ones and mints the next general code. Every change needs the 5-minute `administration` marker, calls the same issuance and revocation functions the seed uses, and is audited, including refused attempts. A person without a marker is offered the step-up and returns to the page.

## Boundaries & Constraints

**Always:** Consult `node_modules/next/dist/docs/` before writing Next.js code (AGENTS.md). The page is `/admin/invitations`, for an active Administrator; any other Account gets a 404, and a Settings section links to it for Administrators only. Three Server Actions (issue a named code, mint or replace the general code, revoke) each run behind `withActiveAccount` and, in this order: confirm the Account's role is `administrator`; check the session's `administration` marker (`checkMarker`; anything but `allowed` is a refusal, and `none` or `expired` offers the step-up); then call `issueInvitation` or `revokeInvitation` with actor `user:<Auth user ID>` taken from the verified session, never from input. A code's value is returned once, in that action's response, and shown with a copy action; it is held in client state only (not in a URL, storage, cookie or the router cache) and is never logged, audited or listed again. The list shows each code's invitation ID, kind, label, status (Unused, Used, Revoked, as words and shapes, not colour alone) and creation time, newest first. Replacing an unused general code (it revokes the current one) and revoking any code ask for confirmation in a dialog that starts on Cancel. A new migration adds one service-role-only function that records a refused attempt (`invitation.issue_refused`, `invitation.revoke_refused` by an Administrator without a valid marker; `invitation.denied` by an Account that is not an Administrator), with the actor and, for a revoke, the invitation as target, deduplicated to once an hour per actor, action and target, and never a label, code or reason text. The step-up page tells the person what is being confirmed (administration) and which Google address is signed in; `stepUpReturnPaths.administration` becomes `/admin/invitations`. English and Hebrew (right to left), light and dark, phone and desktop, WCAG 2.2 AA; new Hebrew is machine-drafted and flagged for native review. A provisioning-ledger attestation, due at this story, asks Josh to run the hosted step-up check (`docs/auth-setup.md`) and the new invitation check on staging.

**Ask First:** Any change to what `api.issue_invitation` or `api.revoke_invitation` do (the seed shares them); new environment variables or secrets; any step against staging or production.

**Never:** A code's value stored or returned anywhere but the one response; labels or reasons in audit rows; email sending or binding a code to an address; code expiry; editing or deleting a code; granting administrators; Account administration (Story 1.5); the hash-key canary and restoring the initiating session after a failed step-up (both stay deferred); Redis; a marker check only in the browser.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Issue a named code | Administrator, valid marker, label | code shown once with copy; list gains an Unused row; `invitation.issued` | N/A |
| No valid marker | issue, revoke or mint | nothing changes; notice offers the step-up; `…_refused` audited | N/A |
| After the step-up | return to the page | works for 5 minutes, then refused again | N/A |
| Revoke | unused code, marker | Revoked; `invitation.revoked` | used code stays Used; unknown ID: not found |
| General code used | page opened | no unused general code listed; Mint needs a marker and shows it once | N/A |
| Unused general exists | mint | offers Replace with confirmation | two tabs at once: one issues, one is told a code exists |
| Not an Administrator | open page, or call an action | 404; action refused and `invitation.denied` audited, nothing changes | N/A |
| Bad label | empty, blank or over 80 characters | field error, nothing sent | N/A |
| Database unreachable | any action | retryable notice, nothing issued | outcome unknown: told to check the list first |
| Code value elsewhere | logs, audit rows, list, URL | never present | N/A |

</frozen-after-approval>

## Code Map

- `lib/accounts.ts` -- `issueInvitation` (:829), `revokeInvitation`, `listInvitations`, `checkMarker` (:697): reuse; add a typed `recordInvitationRefusal`. `supabase/migrations/20261010120100_api.sql` -- `api.issue_invitation` (:451, audits `invitation.issued`), `api.revoke_invitation` (:513), `api.list_invitations` (:560); `20261010120000_accounts.sql` -- `identity.audit_events` (:203, target pattern `kind:id`, no content), `record_audit_once` (:241). `20261011120000_step_up.sql` -- `api.use_marker` (:362, administration is reusable for 5 minutes).
- `lib/auth.ts` -- `getAccess`, `requireActiveAccount`, `withActiveAccount` (:162); add `requireAdministrator` for pages. `lib/step-up.ts` -- `stepUpReturnPaths`, `stepUpUrl`; `app/step-up/page.tsx`, `components/step-up-form.tsx`, `lib/i18n/en.ts` (`stepUp.*`) -- add wording per class and the signed-in address.
- `components/settings/settings-content.tsx` (client; the role must come from `app/settings/page.tsx`), `components/shell/routes.ts` (`parentRoute` would send Back to `/admin`, which does not exist), `components/ui/{dialog,states,button,status-badge}.tsx`, `lib/session-actions.ts` and `components/use-session-action.ts` (action-state pattern), `components/ui/announcer.tsx`.
- `tests/unit/gate-structure.test.ts` (:410 asserts no sensitive action checks a marker: update it), `tests/unit/page-guards.test.ts` (every page calls `requireActiveAccount`), `tests/support/forged-session.ts` (`issueCode`, `activate`, `markerOutcome`, `markersOf`; needs an Administrator and a forged marker), `tests/e2e/step-up.spec.ts` (real step-up with the fake Google), `scripts/seed-accounts.mjs` (shares the functions), `provisioning/ledger.json` and `docs/provisioning.md` (generated: `npm run render:provisioning`), `docs/auth-setup.md`, `docs/staging.md` (must name the new migration), `deferred-work.md` entries mapped to 1.11.

## Tasks & Acceptance

**Execution:**
- [ ] `supabase/migrations/*_invitation_refusals.sql`, `lib/accounts.ts` -- refusal-recording function and typed call -- AC-3
- [ ] `lib/auth.ts`, `app/admin/invitations/{page,actions}.tsx`, `components/admin/*`, `app/settings/page.tsx`, `components/settings/settings-content.tsx`, `components/shell/routes.ts` -- the page, three actions, Settings link, Back target -- AC-1, AC-2, AC-4
- [ ] `lib/step-up.ts`, `app/step-up/page.tsx`, `components/step-up-form.tsx`, `lib/i18n/{en,he}.ts` -- return path, per-class wording, signed-in address, page strings -- AC-1
- [ ] `tests/` -- every matrix row: unit (actions with faked calls: role, each marker outcome, order, no code in any log), integration (the new function: closed, validated, deduplicated, no content), browser on desktop and phone (refusal and step-up offered, issue, show-once, list, copy, revoke, general after use, concurrent mint, non-Administrator, axe in four variants, 320 px at 200% text, keyboard and dialog focus); update the structural tests -- all ACs
- [ ] `provisioning/ledger.json`, `docs/{provisioning,auth-setup,staging,deployment-setup}.md`, `README.md`, `deferred-work.md` -- the attestation, a hosted check, resolved and remaining entries -- housekeeping

**Acceptance Criteria:**
- Given an Administrator session without a fresh marker, when issuance or revocation is attempted, then it is refused and the step-up is offered; with a valid 5-minute marker it succeeds.
- Given a created code, when it is displayed and later listed, then the value is shown once with a copy action, only its identifier, label and status are listed afterwards, and logs never contain it.
- Given issue, revoke and refused attempts, when the audit trail is reviewed, then each has an immutable event with actor and time and no code value, and the page works on phone and desktop.
- Given the current general code was just used by a registration, when the Administrator opens the page, then no general code is listed as unused, and minting the next one needs a marker and shows it once.

## Spec Change Log

## Design Notes

The marker is checked in the action, not inside the issuance function: the seed script shares that function and has no session, and the `administration` marker is reusable for its five minutes, so a check followed by the call loses nothing. Refusals are deduplicated by the existing `record_audit_once` so a person who keeps pressing cannot grow an append-only table. The page also asks `checkMarker` when it renders, only to decide whether to show "Confirm it's you" beforehand; the action is the authority. The page is a Server Component that renders the list; the forms are client components using the action-state pattern of the sign-out buttons.

## Verification

**Commands:**
- `npm run typecheck && npm run lint && npm run build` -- expected: exit 0
- `supabase start && npm test` -- expected: unit and integration pass, every matrix row covered
- `CI=1 npm run test:e2e` (clean scratch copy, stack started as CI does, fake Google active) -- expected: all flows pass on both projects
- `node scripts/ci/check-repository.mjs && npm run render:provisioning -- --check && npm run test:env` -- expected: exit 0

**Manual checks (if no CLI):**
- Open the page as an Administrator on a phone-width window in Hebrew and dark: every state reads in words, and Copy works.
