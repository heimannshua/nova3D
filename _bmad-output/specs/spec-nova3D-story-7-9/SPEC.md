---
id: SPEC-nova3D-story-7-9
status: final
companions:
- acceptance-criteria.md
- implementation-constraints.md
- ../spec-nova3D/SPEC.md
sources:
- ../../planning-artifacts/story-inputs/story-7-9.json
---

# Story 7.9: Capture and confirm images on the device

## Why

An Account owner needs to choose or photograph images and confirm them without a network. Direct conversion can start offline.

## Capabilities

- **CAP-1**
  - **intent:** An Account owner can choose or photograph images and confirm them without a network.
  - **success:** Ordered images are stored locally under stable UUIDs, camera denial leaves file intake usable, and the flow works on phone and desktop.

All [acceptance criteria](acceptance-criteria.md) apply to the complete story.

## Constraints

- This story implements the declared slice after its listed dependencies; it does not absorb unrelated parent capabilities.
- The [implementation constraints](implementation-constraints.md) and recursively adopted parent contract are mandatory, including ratified overrides to older source wording.
- Existing product decisions remain binding. Spec completion does not establish implementation, device support or engineering-gate acceptance.

## Non-goals

- Implementing unassigned later-story behavior or creating all future domain entities in advance.
- Adding manual mesh editing, public registration, printer control or commercial storefront behavior.

## Success signal

Ordered images are stored locally under stable UUIDs, camera denial leaves file intake usable, and the flow works on phone and desktop. The exact criteria demonstrate the complete story outcome and its failure boundaries; any gate-status change requires actual qualification evidence.

## Assumptions

- Story boundaries and ordering are delegated fast-path planning choices; they do not claim separate user approval. Detailed shared assumptions remain in the constraints companion.
