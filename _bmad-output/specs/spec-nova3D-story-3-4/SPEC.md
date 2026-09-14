---
id: SPEC-nova3D-story-3-4
status: final
companions:
- acceptance-criteria.md
- implementation-constraints.md
- ../spec-nova3D/SPEC.md
sources:
- ../../planning-artifacts/story-inputs/story-3-4.json
---

# Story 3.4: Inspect sources and choose defensible interpretations

## Why

An Account owner needs to compare explanations and alternatives. They can select an interpretation with its geometry consequences.

## Capabilities

- **CAP-1**
  - **intent:** An Account owner can compare explanations and alternatives.
  - **success:** Original, translation, citation and explanation remain distinct and readable without pausing the Job.

All [acceptance criteria](acceptance-criteria.md) apply to the complete story.

## Constraints

- This story implements the declared slice after its listed dependencies; it does not absorb unrelated parent capabilities.
- The [implementation constraints](implementation-constraints.md) and recursively adopted parent contract are mandatory, including ratified overrides to older source wording.
- Existing product decisions remain binding. Spec completion does not establish implementation, device support or engineering-gate acceptance.

## Non-goals

- Implementing unassigned later-story behavior or creating all future domain entities in advance.
- Adding manual mesh editing, public registration, printer control or commercial storefront behavior.

## Success signal

Original, translation, citation and explanation remain distinct and readable without pausing the Job. The exact criteria demonstrate the complete story outcome and its failure boundaries; any gate-status change requires actual qualification evidence.

## Assumptions

- Story boundaries and ordering are delegated fast-path planning choices; they do not claim separate user approval. Detailed shared assumptions remain in the constraints companion.
