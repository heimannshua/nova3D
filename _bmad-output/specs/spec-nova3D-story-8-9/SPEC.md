---
id: SPEC-nova3D-story-8-9
status: final
companions:
- acceptance-criteria.md
- implementation-constraints.md
- ../spec-nova3D/SPEC.md
sources:
- ../../planning-artifacts/story-inputs/story-8-9.json
---

# Story 8.9: Back up the database and Storage independently

## Why

An Administrator needs to have encrypted backups of the database and every stored file made on their own every 12 hours. A lost provider or a bad change cannot take their users' work.

## Capabilities

- **CAP-1**
  - **intent:** An Administrator can have encrypted backups of the database and every stored file made on their own every 12 hours.
  - **success:** An encrypted dump and a deletion-mirroring Storage copy reach the bucket, nothing is persisted on Railway, the manifest records cutoff, counts and digests, and the service cannot decrypt what it wrote.

All [acceptance criteria](acceptance-criteria.md) apply to the complete story.

## Constraints

- This story implements the declared slice after its listed dependencies; it does not absorb unrelated parent capabilities.
- The [implementation constraints](implementation-constraints.md) and recursively adopted parent contract are mandatory, including ratified overrides to older source wording.
- Existing product decisions remain binding. Spec completion does not establish implementation, device support or engineering-gate acceptance.

## Non-goals

- Implementing unassigned later-story behavior or creating all future domain entities in advance.
- Adding manual mesh editing, public registration, printer control or commercial storefront behavior.

## Success signal

An encrypted dump and a deletion-mirroring Storage copy reach the bucket, nothing is persisted on Railway, the manifest records cutoff, counts and digests, and the service cannot decrypt what it wrote. The exact criteria demonstrate the complete story outcome and its failure boundaries; any gate-status change requires actual qualification evidence.

## Assumptions

- Story boundaries and ordering are delegated fast-path planning choices; they do not claim separate user approval. Detailed shared assumptions remain in the constraints companion.
