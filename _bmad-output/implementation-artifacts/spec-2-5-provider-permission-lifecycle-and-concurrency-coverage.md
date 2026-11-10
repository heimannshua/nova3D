---
title: 'Story 2.5 follow-up: Provider permission lifecycle and concurrency coverage'
type: 'chore'
created: '2026-10-25'
status: 'blocked'
baseline_revision: 'cf9bcfaafb09ffb8fa5845537557a6227350f8ab'
review_loop_iteration: 0
followup_review_recommended: false
context:
  - ../../specs/spec-nova3D-story-2-5/acceptance-criteria.md
  - ../../specs/spec-nova3D-story-2-5/implementation-constraints.md
  - epic-2-context.md
warnings: []
deferred: []
---

## Intent

**Problem:** Story 2.5 has guarded permission persistence and atomic reservation admission, but tests do not yet qualify permission lifecycle boundaries or races between permission replacement, Job termination, and admission.

**Approach:** Add focused unit and database integration coverage for the existing fail-closed permission contract without creating a paid Job quote/start flow or enabling provider dispatch.

## Boundaries & Constraints

**Always:** Assert permissions are isolated to Account, Project, Job, category, provider, purpose, outbound data, disclosed maximum, revocation, expiry, and Job terminal state. Use separate database connections for concurrency cases where supported. Preserve the rule that no provider operation dispatches before permission-aware reservation succeeds.

**Block If:** A test would require inventing authoritative quote inputs, vendor terms/rates, or a paid Job start contract absent from this checkout.

**Never:** Mount a product consent flow without a real paid Job quote/start surface; change provider enablement or claim human provisioning evidence; edit orchestrator-owned `sprint-status.yaml`.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|----------------------------|----------------|
| Exact grant | Live grant matches every admission field | Reservation succeeds once | None |
| Expired or terminal grant | Grant is expired or its Job is terminal | Admission refuses and creates no reservation | Return the existing refusal outcome |
| Scope mismatch | Account, Project, Job, category, provider, purpose, data, or maximum differs | Admission refuses and creates no reservation | Fail closed |
| Concurrent replacement | Admission races with grant supersession on separate connections | No admission uses a superseded grant after replacement commits | Transaction serialization |
| Concurrent termination | Admission races with Job terminal transition | No admission is accepted after terminal state commits | Transaction locking |

## Code Map

- `lib/providers/permissions.ts` -- `createPermissionStore` and strict snapshot decoding; unit tests currently cover decode success and malformed rows.
- `supabase/migrations/20261025120000_provider_permissions.sql` and `20261028120000_harden_provider_permission_admission.sql` -- grant lifecycle, expiry, allowed scopes, serialization, and Job-state locking.
- `supabase/migrations/20261029120000_require_provider_permission.sql` -- legacy reservation fail-closed boundary.
- `supabase/migrations/20261030120000_bind_provider_permission_to_operation.sql` -- verifies that the requested operation is actually owned by the permission's Project and Job before admission.
- `lib/usage-reservations.ts` -- permission-aware reservation payload.
- `tests/integration/usage-reservations.test.ts` -- existing exact-match, purpose mismatch, maximum, and revoke admission case; extend with lifecycle and cross-connection races.
- `tests/unit/provider-permissions.test.ts` -- extend store operation payload and malformed-result coverage.
- `components/projects/paid-permission-panel.tsx` and `tests/unit/paid-permission-panel.test.tsx` -- disabled disclosure boundary; no paid Job quote/start route currently mounts it.

## Tasks & Acceptance

**Execution:**
- `tests/unit/provider-permissions.test.ts` -- cover grant/get/revoke argument mapping, empty lookup, malformed result cardinality, and invalid revoke response -- store boundary remains strictly decoded.
- `tests/integration/usage-reservations.test.ts` -- cover expired, terminal, cross-Account/Project/Job, and outbound-data mismatch refusals with no reservation side effects -- lifecycle dimensions remain enforced by SQL.
- `tests/integration/usage-reservations.test.ts` -- add separate-connection admission races against permission replacement and Job terminal transition, using deterministic synchronization and existing fixtures -- transactional guarantees are qualified across connections.
- `tests/unit/paid-permission-panel.test.tsx` -- cover permission-off default, accessible disclosure fields, and disabled grant behavior -- the reusable panel makes no false grant claim while quote inputs are absent.
- `docs/staging.md` -- document the forward-only migration in version order -- staging instructions name every migration.

**Acceptance Criteria:**
- Given a malformed or mismatched persisted permission, when the store or admission path reads it, then it fails closed without creating a reservation.
- Given an expired, revoked, terminal, or superseded permission, when admission runs, then it refuses and leaves reservation state unchanged.
- Given concurrent admission and replacement or Job termination, when both transactions race on separate connections, then no operation is admitted using a permission that is no longer live at commit.
- Given an operation whose actual Job or Project differs from the submitted permission scope, when admission runs, then it refuses before reservation creation.
- Given no authoritative paid Job quote/start path, when the disclosure panel is rendered, then permission remains off and grant stays disabled without client-supplied pricing.

## Spec Change Log

- 2026-10-25 — Implementation discovery showed the admission overload compared the grant against caller-supplied Project and Job IDs without binding those IDs to the requested operation. Added a forward-only migration and an acceptance criterion for the ownership check; this closes a cross-Job authorization gap rather than weakening the permission contract.

## Design Notes

Tests must exercise the existing database functions and public store boundary rather than duplicate SQL rules in test-only helpers. Race tests should control transaction ordering with explicit barriers and assert final ledger state, not rely on sleeps.

## Verification

**Commands:**
- `npx vitest run tests/unit/provider-permissions.test.ts tests/unit/paid-permission-panel.test.tsx tests/integration/usage-reservations.test.ts` -- expected: all focused tests pass.
- `git diff --check` -- expected: no whitespace errors.

## Auto Run Result

Status: blocked
Blocking condition: local Supabase stack unavailable; integration verification and matrix audit could not run.
Implemented: permission store and disclosure panel unit coverage; lifecycle, scope-mismatch and separate-connection race cases; migration binding permission scope to the operation's actual Job and Project; staging migration documentation.
Verification: `npx vitest run tests/unit/provider-permissions.test.ts tests/unit/paid-permission-panel.test.tsx` passed (15 tests); `npm run typecheck` passed; `git diff --check` passed. The full focused command failed during integration global setup because Supabase was not running and Docker was unavailable. `supabase migration up --local` also failed to connect to `127.0.0.1:54322`.
Remaining: start the local Docker/Supabase stack, apply the pending migration, then run the full focused verification command and audit every matrix row against the passing integration output.
