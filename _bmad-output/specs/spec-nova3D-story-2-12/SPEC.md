---
id: SPEC-nova3D-story-2-12
status: final
companions:
- acceptance-criteria.md
- implementation-constraints.md
- ../spec-nova3D/SPEC.md
sources:
- ../../planning-artifacts/story-inputs/story-2-12.json
---

# Story 2.12: Retain confirmed pictures as immutable Project artifacts

## Why

An Account owner needs to have their confirmed pictures kept with the request that used them. Later research, conversion and recovery use the exact pictures they confirmed.

## Capabilities

- **CAP-1**
  - **intent:** An Account owner can have their confirmed pictures kept with the request that used them.
  - **success:** Each picture has a verified manifest root, the request revision references the ordered roots and the staging copies expire.

All [acceptance criteria](acceptance-criteria.md) apply to the complete story.

## Constraints

- This story implements the declared slice after its listed dependencies; it does not absorb unrelated parent capabilities.
- The [implementation constraints](implementation-constraints.md) and recursively adopted parent contract are mandatory, including ratified overrides to older source wording.
- Existing product decisions remain binding. Spec completion does not establish implementation, device support or engineering-gate acceptance.

## Non-goals

- Implementing unassigned later-story behavior or creating all future domain entities in advance.
- Adding manual mesh editing, public registration, printer control or commercial storefront behavior.

## Success signal

Each picture has a verified manifest root, the request revision references the ordered roots and the staging copies expire. The exact criteria demonstrate the complete story outcome and its failure boundaries; any gate-status change requires actual qualification evidence.

## Assumptions

- Story boundaries and ordering are delegated fast-path planning choices; they do not claim separate user approval. Detailed shared assumptions remain in the constraints companion.
