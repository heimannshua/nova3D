---
id: SPEC-nova3D-story-7-6
status: final
companions:
- acceptance-criteria.md
- implementation-constraints.md
- ../spec-nova3D/SPEC.md
sources:
- ../../planning-artifacts/story-inputs/story-7-6.json
---

# Story 7.6: Qualify and recover direct models through the shared lineage

## Why

An Account owner needs to validate and export an image-derived model. Direct mode receives the same model and print gates.

## Capabilities

- **CAP-1**
  - **intent:** Export direct models only through trusted online approval and validation.
  - **success:** Given a synchronized direct candidate, when qualified export is requested, then connection, trusted exact-model approval and all required profile checks are enforced; local labels or approvals do not establish server authority.

- **CAP-2**
  - **intent:** Use the single shared lineage slot for constrained direct reconversion.
  - **success:** Given failed local repair and an unused shared lineage slot, when direct reconversion is dispatched, then the unique slot and successor Job/outbox commit atomically using pinned original images/scope/engine, failed print constraints and a new settings digest.

- **CAP-3**
  - **intent:** Preserve original versions and require renewed approval after successful recovery.
  - **success:** Given an incapable engine, consumed slot or completed reconversion, when recovery finishes, then failure stops without resetting lineage; success preserves the original and returns a new version to inspection/approval/full validation with honest direct provenance.

All [acceptance criteria](acceptance-criteria.md) apply to the complete story.

## Constraints

- This story implements the declared slice after its listed dependencies; it does not absorb unrelated parent capabilities.
- The [implementation constraints](implementation-constraints.md) and recursively adopted parent contract are mandatory, including ratified overrides to older source wording.
- Existing product decisions remain binding. Spec completion does not establish implementation, device support or engineering-gate acceptance.

## Non-goals

- Implementing unassigned later-story behavior or creating all future domain entities in advance.
- Adding manual mesh editing, public registration, printer control or commercial storefront behavior.

## Success signal

Connection, trusted exact-model approval and all required profile checks are enforced; local labels or approvals do not establish server authority. The exact criteria demonstrate the complete story outcome and its failure boundaries; any gate-status change requires actual qualification evidence.

## Assumptions

- Story boundaries and ordering are delegated fast-path planning choices; they do not claim separate user approval. Detailed shared assumptions remain in the constraints companion.
