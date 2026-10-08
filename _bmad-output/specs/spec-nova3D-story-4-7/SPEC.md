---
id: SPEC-nova3D-story-4-7
status: final
companions:
- acceptance-criteria.md
- implementation-constraints.md
- ../spec-nova3D/SPEC.md
sources:
- ../../planning-artifacts/story-inputs/story-4-7.json
---

# Story 4.7: Produce coarse and full GLB viewing derivatives

## Why

An Account owner needs to open a model quickly and see more detail as it loads. Inspection is fast without changing manufacturing geometry.

## Capabilities

- **CAP-1**
  - **intent:** An Account owner can open a model quickly and see more detail as it loads.
  - **success:** The coarse GLB of at most 5 MB and the full GLB set of at most 20 MB are published as manifests with transform metadata and semantic feature maps.

All [acceptance criteria](acceptance-criteria.md) apply to the complete story.

## Constraints

- This story implements the declared slice after its listed dependencies; it does not absorb unrelated parent capabilities.
- The [implementation constraints](implementation-constraints.md) and recursively adopted parent contract are mandatory, including ratified overrides to older source wording.
- Existing product decisions remain binding. Spec completion does not establish implementation, device support or engineering-gate acceptance.

## Non-goals

- Implementing unassigned later-story behavior or creating all future domain entities in advance.
- Adding manual mesh editing, public registration, printer control or commercial storefront behavior.

## Success signal

The coarse GLB of at most 5 MB and the full GLB set of at most 20 MB are published as manifests with transform metadata and semantic feature maps. The exact criteria demonstrate the complete story outcome and its failure boundaries; any gate-status change requires actual qualification evidence.

## Assumptions

- Story boundaries and ordering are delegated fast-path planning choices; they do not claim separate user approval. Detailed shared assumptions remain in the constraints companion.
