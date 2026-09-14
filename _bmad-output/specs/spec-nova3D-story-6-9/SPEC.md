---
id: SPEC-nova3D-story-6-9
status: final
companions:
- acceptance-criteria.md
- implementation-constraints.md
- ../spec-nova3D/SPEC.md
sources:
- ../../planning-artifacts/story-inputs/story-6-9.json
---

# Story 6.9: Stream private files with live revocation

## Why

An Account owner needs to download their exports on phone or computer. Large files remain private and access stops when revoked.

## Capabilities

- **CAP-1**
  - **intent:** An Account owner can download their exports on phone or computer.
  - **success:** Each range and each chunk of at most 1 MiB checks live session/Account/Project/artifact state; no reusable signed storage URL is exposed.

All [acceptance criteria](acceptance-criteria.md) apply to the complete story.

## Constraints

- This story implements the declared slice after its listed dependencies; it does not absorb unrelated parent capabilities.
- The [implementation constraints](implementation-constraints.md) and recursively adopted parent contract are mandatory, including ratified overrides to older source wording.
- Existing product decisions remain binding. Spec completion does not establish implementation, device support or engineering-gate acceptance.

## Non-goals

- Implementing unassigned later-story behavior or creating all future domain entities in advance.
- Adding manual mesh editing, public registration, printer control or commercial storefront behavior.

## Success signal

Each range and each chunk of at most 1 MiB checks live session/Account/Project/artifact state; no reusable signed storage URL is exposed. The exact criteria demonstrate the complete story outcome and its failure boundaries; any gate-status change requires actual qualification evidence.

## Assumptions

- Story boundaries and ordering are delegated fast-path planning choices; they do not claim separate user approval. Detailed shared assumptions remain in the constraints companion.
