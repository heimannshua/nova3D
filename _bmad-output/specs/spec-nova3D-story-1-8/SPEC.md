---
id: SPEC-nova3D-story-1-8
status: final
companions:
- acceptance-criteria.md
- implementation-constraints.md
- ../spec-nova3D/SPEC.md
sources:
- ../../planning-artifacts/story-inputs/story-1-8.json
---

# Story 1.8: Define tombstones and the hidden-state contract

## Why

An Account owner needs to have deleted or disabled private targets stop being reachable at once. Later features cannot bypass deletion or revocation.

## Capabilities

- **CAP-1**
  - **intent:** An Account owner can have deleted or disabled private targets stop being reachable at once.
  - **success:** The guard rejects it before any other effect and returns an unavailable state without disclosing contents.

All [acceptance criteria](acceptance-criteria.md) apply to the complete story.

## Constraints

- This story implements the declared slice after its listed dependencies; it does not absorb unrelated parent capabilities.
- The [implementation constraints](implementation-constraints.md) and recursively adopted parent contract are mandatory, including ratified overrides to older source wording.
- Existing product decisions remain binding. Spec completion does not establish implementation, device support or engineering-gate acceptance.

## Non-goals

- Implementing unassigned later-story behavior or creating all future domain entities in advance.
- Adding manual mesh editing, public registration, printer control or commercial storefront behavior.

## Success signal

The guard rejects it before any other effect and returns an unavailable state without disclosing contents. The exact criteria demonstrate the complete story outcome and its failure boundaries; any gate-status change requires actual qualification evidence.

## Assumptions

- Story boundaries and ordering are delegated fast-path planning choices; they do not claim separate user approval. Detailed shared assumptions remain in the constraints companion.
