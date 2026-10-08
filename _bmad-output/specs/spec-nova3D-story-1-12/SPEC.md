---
id: SPEC-nova3D-story-1-12
status: final
companions:
- acceptance-criteria.md
- implementation-constraints.md
- ../spec-nova3D/SPEC.md
sources:
- ../../planning-artifacts/story-inputs/story-1-12.json
---

# Story 1.12: Transfer private files through the authorized gateway

## Why

An Account owner needs to upload and download their private files through one gateway that rechecks their access. Files stay private and access stops when it is revoked.

## Capabilities

- **CAP-1**
  - **intent:** An Account owner can upload and download their private files through one gateway that rechecks their access.
  - **success:** Checksum, content type, ownership and quota are enforced before anything is attached, a foreign upload ID is rejected, and the file never passes through a Vercel function.

All [acceptance criteria](acceptance-criteria.md) apply to the complete story.

## Constraints

- This story implements the declared slice after its listed dependencies; it does not absorb unrelated parent capabilities.
- The [implementation constraints](implementation-constraints.md) and recursively adopted parent contract are mandatory, including ratified overrides to older source wording.
- Existing product decisions remain binding. Spec completion does not establish implementation, device support or engineering-gate acceptance.

## Non-goals

- Implementing unassigned later-story behavior or creating all future domain entities in advance.
- Adding manual mesh editing, public registration, printer control or commercial storefront behavior.

## Success signal

Checksum, content type, ownership and quota are enforced before anything is attached, a foreign upload ID is rejected, and the file never passes through a Vercel function. The exact criteria demonstrate the complete story outcome and its failure boundaries; any gate-status change requires actual qualification evidence.

## Assumptions

- Story boundaries and ordering are delegated fast-path planning choices; they do not claim separate user approval. Detailed shared assumptions remain in the constraints companion.
