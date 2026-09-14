---
id: SPEC-nova3D-story-7-1
status: final
companions:
- acceptance-criteria.md
- implementation-constraints.md
- ../spec-nova3D/SPEC.md
sources:
- ../../planning-artifacts/story-inputs/story-7-1.json
---

# Story 7.1: Qualify a bounded multi-view reconstruction engine

## Why

A maintainer needs to have a viable on-device conversion engine. Offline creation can meet the adopted device limits.

## Capabilities

- **CAP-1**
  - **intent:** A maintainer can have a viable on-device conversion engine.
  - **success:** Exact weights/runtime/digests and evidence establish ≤500 MiB preparation download, ≤1 GiB working memory and ≤120 s local conversion on the adopted R-5 devices.

All [acceptance criteria](acceptance-criteria.md) apply to the complete story.

## Constraints

- This story implements the declared slice after its listed dependencies; it does not absorb unrelated parent capabilities.
- The [implementation constraints](implementation-constraints.md) and recursively adopted parent contract are mandatory, including ratified overrides to older source wording.
- Existing product decisions remain binding. Spec completion does not establish implementation, device support or engineering-gate acceptance.

## Non-goals

- Implementing unassigned later-story behavior or creating all future domain entities in advance.
- Adding manual mesh editing, public registration, printer control or commercial storefront behavior.

## Success signal

Exact weights/runtime/digests and evidence establish ≤500 MiB preparation download, ≤1 GiB working memory and ≤120 s local conversion on the adopted R-5 devices. The exact criteria demonstrate the complete story outcome and its failure boundaries; any gate-status change requires actual qualification evidence.

## Assumptions

- Story boundaries and ordering are delegated fast-path planning choices; they do not claim separate user approval. Detailed shared assumptions remain in the constraints companion.
