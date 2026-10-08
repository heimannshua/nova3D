---
id: SPEC-nova3D-story-7-8
status: final
companions:
- acceptance-criteria.md
- implementation-constraints.md
- ../spec-nova3D/SPEC.md
sources:
- ../../planning-artifacts/story-inputs/story-7-8.json
---

# Story 7.8: Recover direct models with one pinned reconversion

## Why

An Account owner needs to retry a failed direct model once from their original pictures. A repair failure does not force them to start over, and recovery cannot loop.

## Capabilities

- **CAP-1**
  - **intent:** Use the single shared lineage slot for constrained direct reconversion.
  - **success:** Given failed local repair and an unused shared lineage slot, when reconversion is requested, then the unique slot and the successor Job/outbox commit atomically using the pinned original pictures/scope/engine, failed print constraints and a new settings digest.

- **CAP-2**
  - **intent:** Preserve original versions and require renewed approval after successful recovery.
  - **success:** Given an incapable engine, a consumed slot or a completed reconversion, when the outcome is recorded, then failure stops without resetting the lineage, and success preserves the original and returns a new version to inspection, approval and full validation with honest direct provenance.

All [acceptance criteria](acceptance-criteria.md) apply to the complete story.

## Constraints

- This story implements the declared slice after its listed dependencies; it does not absorb unrelated parent capabilities.
- The [implementation constraints](implementation-constraints.md) and recursively adopted parent contract are mandatory, including ratified overrides to older source wording.
- Existing product decisions remain binding. Spec completion does not establish implementation, device support or engineering-gate acceptance.

## Non-goals

- Implementing unassigned later-story behavior or creating all future domain entities in advance.
- Adding manual mesh editing, public registration, printer control or commercial storefront behavior.

## Success signal

The unique slot and the successor Job/outbox commit atomically using the pinned original pictures/scope/engine, failed print constraints and a new settings digest. The exact criteria demonstrate the complete story outcome and its failure boundaries; any gate-status change requires actual qualification evidence.

## Assumptions

- Story boundaries and ordering are delegated fast-path planning choices; they do not claim separate user approval. Detailed shared assumptions remain in the constraints companion.
