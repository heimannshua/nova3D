---
id: SPEC-nova3D-story-4-6
status: final
companions:
- acceptance-criteria.md
- implementation-constraints.md
- ../spec-nova3D/SPEC.md
sources:
- ../../planning-artifacts/story-inputs/story-4-6.json
---

# Story 4.6: Inspect progressive read-only models

## Why

An Account owner needs to inspect shape and exact dimensions. They can understand the model on phone or computer.

## Capabilities

- **CAP-1**
  - **intent:** Inspect shape and measure canonical dimensions with touch or keyboard.
  - **success:** Given a model with canonical dimensions, when view and measurement controls are used by touch or keyboard, then all required inspection actions operate and dimensions use canonical geometry or labeled exact records rather than pixels.

- **CAP-2**
  - **intent:** Preserve feature and evidence selection across viewing-detail changes.
  - **success:** Given coarse and full derivatives, when LOD switches, then semantic feature/evidence selection is preserved atomically while preview transformations never alter manufacturing content.

- **CAP-3**
  - **intent:** Continue semantic inspection when the GPU preview fails.
  - **success:** Given GPU/WebGL loss or a degraded preview, when inspection falls back, then static views and semantic feature/evidence/dimension lists remain usable without claiming a passed interactive 3D benchmark.

All [acceptance criteria](acceptance-criteria.md) apply to the complete story.

## Constraints

- This story implements the declared slice after its listed dependencies; it does not absorb unrelated parent capabilities.
- The [implementation constraints](implementation-constraints.md) and recursively adopted parent contract are mandatory, including ratified overrides to older source wording.
- Existing product decisions remain binding. Spec completion does not establish implementation, device support or engineering-gate acceptance.

## Non-goals

- Implementing unassigned later-story behavior or creating all future domain entities in advance.
- Adding manual mesh editing, public registration, printer control or commercial storefront behavior.

## Success signal

All required inspection actions operate and dimensions use canonical geometry or labeled exact records rather than pixels. The exact criteria demonstrate the complete story outcome and its failure boundaries; any gate-status change requires actual qualification evidence.

## Assumptions

- Story boundaries and ordering are delegated fast-path planning choices; they do not claim separate user approval. Detailed shared assumptions remain in the constraints companion.
