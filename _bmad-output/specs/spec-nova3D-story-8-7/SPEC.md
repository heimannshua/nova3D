---
id: SPEC-nova3D-story-8-7
status: final
companions:
- acceptance-criteria.md
- implementation-constraints.md
- ../spec-nova3D/SPEC.md
sources:
- ../../planning-artifacts/story-inputs/story-8-7.json
---

# Story 8.7: Prove cross-provider and first-version acceptance

## Why

A maintainer needs to see evidence that the integrated product meets its contract. Release decisions reflect the complete application.

## Capabilities

- **CAP-1**
  - **intent:** Verify cross-provider environment, callback and private-file behavior.
  - **success:** Given staging services and actual provider settings, when callback, private-file, environment isolation and rollout/rollback drills run, then the recorded Vercel/Supabase/Railway/Upstash topology enforces signed environment identity, consumer-before-producer evolution and redacted operational monitoring.

- **CAP-2**
  - **intent:** Demonstrate the complete integrated acceptance contract.
  - **success:** Given the complete evidence altar/ramp and direct/offline regression suites, when integrated acceptance runs, then all original PRD metrics, two-account isolation, invitations, cost/retry races, stale approvals, source-policy/cache privacy, repair lineage and deletion-aware restore have required evidence.

- **CAP-3**
  - **intent:** Require qualifying evidence for every applicable release gate.
  - **success:** Given the September 14 PARTIAL/BLOCKED/NOT RUN baseline, when release is considered, then no applicable G-1–G-9 remains open; local probes, documents and a physical-box slice do not establish app acceptance, and physical printing/printer control are not required for the adopted software demonstration.

All [acceptance criteria](acceptance-criteria.md) apply to the complete story.

## Constraints

- This story implements the declared slice after its listed dependencies; it does not absorb unrelated parent capabilities.
- The [implementation constraints](implementation-constraints.md) and recursively adopted parent contract are mandatory, including ratified overrides to older source wording.
- Existing product decisions remain binding. Spec completion does not establish implementation, device support or engineering-gate acceptance.

## Non-goals

- Implementing unassigned later-story behavior or creating all future domain entities in advance.
- Adding manual mesh editing, public registration, printer control or commercial storefront behavior.

## Success signal

The recorded Vercel/Supabase/Railway/Upstash topology enforces signed environment identity, consumer-before-producer evolution and redacted operational monitoring. The exact criteria demonstrate the complete story outcome and its failure boundaries; any gate-status change requires actual qualification evidence.

## Assumptions

- Story boundaries and ordering are delegated fast-path planning choices; they do not claim separate user approval. Detailed shared assumptions remain in the constraints companion.
