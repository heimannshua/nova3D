---
id: SPEC-nova3D-story-2-8
status: final
companions:
- acceptance-criteria.md
- implementation-constraints.md
- ../spec-nova3D/SPEC.md
sources:
- ../../planning-artifacts/story-inputs/story-2-8.json
---

# Story 2.8: Reconcile ambiguous charges without replacement calls

## Why

An Account owner needs to understand and settle uncertain provider costs. Retries cannot double-charge them.

## Capabilities

- **CAP-1**
  - **intent:** An Account owner can understand and settle uncertain provider costs.
  - **success:** The full reservation remains and no SDK retry or replacement request is issued.

All [acceptance criteria](acceptance-criteria.md) apply to the complete story.

## Constraints

- This story implements the declared slice after its listed dependencies; it does not absorb unrelated parent capabilities.
- The [implementation constraints](implementation-constraints.md) and recursively adopted parent contract are mandatory, including ratified overrides to older source wording.
- Existing product decisions remain binding. Spec completion does not establish implementation, device support or engineering-gate acceptance.

## Non-goals

- Implementing unassigned later-story behavior or creating all future domain entities in advance.
- Adding manual mesh editing, public registration, printer control or commercial storefront behavior.

## Success signal

The full reservation remains and no SDK retry or replacement request is issued. The exact criteria demonstrate the complete story outcome and its failure boundaries; any gate-status change requires actual qualification evidence.

## Assumptions

- Story boundaries and ordering are delegated fast-path planning choices; they do not claim separate user approval. Detailed shared assumptions remain in the constraints companion.
