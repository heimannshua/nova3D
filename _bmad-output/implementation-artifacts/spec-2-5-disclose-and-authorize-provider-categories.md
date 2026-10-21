---
title: 'Story 2.5: Disclose and authorize provider categories'
type: 'feature'
created: '2026-10-20'
status: awaiting-operator
review_loop_iteration: 1
baseline_revision: 8255a3a13a008403d21e8ac0fd23574a5ba190de
baseline_commit: 8255a3a13a008403d21e8ac0fd23574a5ba190de
followup_review_recommended: true
operator_actions:
  - Verify Anthropic account terms and data retention or deletion terms, then record the approved evidence in the provider provisioning ledger.
  - Provision Anthropic credentials and a verified rate schedule through the deployment secret manager and controlled usage rate-schedule process.
  - Review Brave Web Search terms and record the review in the Story 1.10 provisioning ledger before enabling Brave.
  - Provision Brave Search credentials and a verified rate schedule through the deployment secret manager and controlled usage rate-schedule process.
context:
  - ../../specs/spec-nova3D-story-2-5/acceptance-criteria.md
  - ../../specs/spec-nova3D-story-2-5/implementation-constraints.md
  - ../../specs/spec-nova3D/SPEC.md
  - ../../specs/spec-nova3D/scope-and-readiness.md
  - ../../specs/spec-nova3D/ux-contract.md
  - ../../specs/spec-nova3D/../../planning-artifacts/prds/prd-nova3D-2026-08-27/prd.md
  - ../../specs/spec-nova3D/../../planning-artifacts/architecture/architecture-nova3D-2026-09-14/ARCHITECTURE-SPINE.md
  - ../../specs/spec-nova3D/../../planning-artifacts/architecture/architecture-nova3D-2026-09-14/RATIFIED-DECISIONS.md
  - ../../specs/spec-nova3D-story-2-6/SPEC.md
---

# Story 2.5: Disclose and authorize provider categories

## Summary

Implement category-scoped paid provider permission and disclosure at the point a paid operation is offered and at every operation admission. Add provider-neutral Anthropic Messages and Brave Search adapters, with Brave disabled until the required terms review is recorded. Keep all outside calls behind the Story 2.6 reservation/admission boundary. Build provider-bound image derivatives that strip metadata and enforce the required JPEG dimensions and size.

## Scope and invariants

- Implement the requirements in `../../specs/spec-nova3D-story-2-5/acceptance-criteria.md` and `implementation-constraints.md`; the project SPEC and recursively listed companions govern shared invariants.
- A permission is bound to one Account, Project, paid category, provider, purpose, outbound-data categories, disclosed maximum, and Job. It expires at Job terminal state or after seven days and can be revoked at any time. Re-match all dimensions inside the Story 2.6 admission transaction for every operation.
- Default permissions are off. No billable operation is dispatched without explicit permission, provider terms/rates verified for enablement, and an admitted reservation within the Account allowance and Job cap.
- Search receives normalized public subjects only. Never send credentials, private raw prompts, unrelated Workspace content, or unapproved personalization.
- Vision/synthesis receives only purpose-required approved Project content. Images are re-encoded JPEG derivatives with metadata removed, long edge at most 1568 px, and size at most 5 MB each.
- Use no paid external 3D provider or billable free-credit fallback. Brave remains disabled until its terms review is recorded in the Story 1.10 ledger. Do not invent or record human verification.
- Permission disclosure includes provider, purpose, outbound-data categories, known retention/deletion limitations, and the computed maximum before the user grants permission.

## Tasks & Acceptance

- [ ] T1 — Add permission persistence and lifecycle in `supabase/migrations/` and `lib/`: model grants with Account/Project/category/provider/purpose/data/max/Job binding, seven-day expiry, Job terminal invalidation, revocation, and least-privilege access. Add tests for isolation, expiry, revocation, and terminal invalidation. (Schema/store/lifecycle, strict row decoding, scoped revoke action, and focused unit tests exist. Full database lifecycle/isolation integration coverage remains.)
- [ ] T2 — Integrate permission matching into `lib/usage-reservations.ts` and the existing job admission path. Match every permission dimension within the same transaction that admits the reservation; reject any mismatch or calculated bound above the disclosed maximum. Add concurrency and mismatch tests proving no dispatch can precede successful admission. (Atomic permission-aware SQL admission and typed call payload exist; no paid Job route invokes it yet. Local migrations apply; concurrency/replay DB tests remain.)
- [ ] T3 — Implement provider-neutral adapters and rate/terms gates under `lib/providers/`: Anthropic Messages (`claude-sonnet-5-5`) and Brave Web Search v1. Keep credentials server-side, redact secrets, fail closed for missing/unverified rates or terms, and keep Brave disabled unless the Story 1.10 ledger records its terms review. Cover normalized public-only search inputs, free-only mode, timeout/ambiguous outcomes, and disabled-provider behavior with tests.
- [ ] T4 — Implement paid-category disclosure and explicit permission controls in the research/start-confirmation surfaces (components and project pages/actions). Show provider, purpose, outbound data, retention/deletion limits, and the calculator-derived maximum before granting; defaults are off; support revocation and phone/desktop layouts. Add accessible UI tests for grant, decline, and revoke. (Reusable panel and scoped authenticated grant/revoke actions exist; Grant always returns disabled because no authoritative paid operation quote or verified rate/terms evidence exists. No Project-wide offer is displayed. The panel is not mounted because this checkout has no paid-start Job/quote surface; full consent/revoke UI remains for that surface.)
- [x] T5 — Implement the provider-bound picture derivative builder under `lib/` and test metadata removal, JPEG encoding, 1568 px long-edge bound, 5 MB bound, and invalid/unsupported input handling. Use retained pictures from Story 2.12; do not alter retained originals.
- [x] T6 — Connect only approved purpose-minimized payloads to adapters. Add tests proving credentials, unrelated Workspace data, private raw search prompts, unapproved personalization, and original image metadata cannot cross provider boundaries.
- [x] T7 — Document required human setup and provider evidence precisely; leave adapters safely disabled where terms/rates or credentials cannot be verified in-repository. Do not claim vendor-console provisioning or terms review occurred without evidence.

Implementation state: local migrations `20261025120000` through `20261029120000` are applied. `npm run typecheck`, seven focused Vitest files (389 tests), the usage-reservations integration file (137 tests), `npm run lint`, and `git diff --check` pass; `supabase db lint --local --schema api,provider_private` reports only pre-existing warnings unrelated to these migrations. T1/T2 now have strict persistence/admission checks and database-backed admission coverage; broader isolation and cross-connection concurrency qualification remains. T4 has a reusable disclosure panel and guarded action boundary, but this checkout has no paid Job start/quote surface to mount it on. Grant fails closed with `operation_quote_unavailable`; no paid operation data, verified rate schedule, or provider terms evidence exists. Human provider setup is documented in `docs/provider-permissions.md`.

## Verification

- Run focused unit, integration, migration, and UI tests added for T1–T6.
- Run the repository's configured lint, typecheck, and production build commands.
- Inspect the adapter payload boundaries and verify disabled/default-off paths fail closed.
- If any provider setup, rate/terms verification, or Story 1.10 ledger action remains a human-only external action, commit all repository work first and finalize `status: awaiting-operator` with imperative `operator_actions` entries.

## Code Map

- Existing job admission/reservations: `lib/usage-reservations.ts`, `lib/job-records.ts`, `lib/jobs.ts`, and `supabase/migrations/20261024120000_usage_reservations.sql`.
- Existing project and picture data: `lib/projects.ts`, `lib/picture-set.ts`, `lib/picture-fetch.ts`, `lib/picture-decode.ts`, `lib/picture-review.ts`, and related migrations.
- Project UI/routes: `app/projects/`, `components/projects/`, `components/shell/routes.ts`.
- New provider adapters, permission storage, and provider-bound derivative code should follow existing `lib/` and migration conventions.

## Design Notes

- Preserve atomic usage reservation/admission from Story 2.6; provider dispatch must be downstream of it.
- Keep provider integration behind narrow interfaces so terms/rate gates and disabled defaults are enforceable in tests.
- Store only the permission snapshot needed to prove the exact authorization; never persist provider secrets or raw payloads in logs.
- Keep all external provider calls server-side. The UI presents authorization and status, not credentials or provider payloads.

## Spec Change Log

- 2026-10-21 — Reconstructed the missing ready-for-dev contract from the canonical Story 2.5 acceptance criteria and implementation constraints after review found the supplied file was only a re-drive note. Added scope, tasks, verification, code map, and design notes. Avoided claiming that provider terms, rates, or vendor setup had been verified.

## Review Triage Log

### 2026-10-21 — Review pass
- intent_gap: 0
- bad_spec: 1: (high 1, medium 0, low 0)
- patch: 0
- defer: 0
- reject: 0
- addressed_findings:
  - `[high]` `[bad_spec]` The supplied ready-for-dev artifact lacked the implementation contract and acceptance criteria; reconstructed this spec from canonical Story 2.5 criteria and constraints so implementation can be derived coherently.

### 2026-10-21 — Final implementation review
- intent_gap: 0
- bad_spec: 0
- patch: 5: (high 2, medium 3, low 0)
- defer: 2
- reject: 0
- addressed_findings:
  - `[high]` `[patch]` Caller-supplied provider evidence could enable adapters; readiness now reads controlled provisioning attestations and server credentials.
  - `[medium]` `[patch]` SQL grant rows lacked category/data validation and could conflict; constraints and serialized supersession now enforce one live scope.
  - `[medium]` `[patch]` Admission could race Job terminal state; permission admission now takes the Job transition lock.
  - `[medium]` `[patch]` Permission-aware SQL admission lacked behavioral integration coverage; valid, mismatched, over-maximum, and revoked cases now run against the local database.
  - `[high]` `[patch]` The legacy reservation API could reserve for Anthropic or Brave without a permission; the public overload now refuses those providers and the permission-aware path uses the private underlying reservation function.
- deferred_findings:
  - `[medium]` `[defer]` The paid Job start/quote UI cannot be mounted until the paid Job surface exists; grant remains disabled rather than accepting client pricing.
  - `[medium]` `[defer]` Cross-connection concurrency qualification for permission replacement/admission remains beyond the current integration case.

## Auto Run Result

Status: awaiting-operator
Summary: Implemented and committed provider permission persistence, guarded admission, payload-boundary enforcement, image derivatives, provider adapters, and setup documentation. Provider dispatch and grants remain disabled pending a paid Job quote surface and human rate/terms evidence.
Files changed: permission actions and panel; provider policy, payload, adapter, image, and persistence modules; five SQL migrations; usage reservation integration; setup documentation; focused unit and integration tests; this specification.
Review findings breakdown: 5 patches applied (2 high, 3 medium); 2 items deferred; 0 items rejected.
Follow-up review recommendation: true (patched counts: high 2, medium 3, low 0; score 13).
Verification: `npm run typecheck`; `npm run lint`; 7 focused unit files, 389 tests passed; `tests/integration/usage-reservations.test.ts`, 137 tests passed; `git diff --check`; local migrations through `20261029120000` applied; `supabase db lint --local --schema api,provider_private` completed with existing unrelated warnings.
Residual risks: human verification and provisioning remain outstanding; Brave stays disabled until its terms review is recorded. The paid Job quote/start UI and cross-connection concurrency qualification remain deferred; permission grants fail closed in their absence. Commit: `adb7250`.
