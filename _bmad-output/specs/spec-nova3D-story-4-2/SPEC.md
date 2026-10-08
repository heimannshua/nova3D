---
id: SPEC-nova3D-story-4-2
status: final
companions:
- acceptance-criteria.md
- implementation-constraints.md
- ../spec-nova3D/SPEC.md
sources:
- ../../planning-artifacts/story-inputs/story-4-2.json
---

# Story 4.2: Generate the approved altar and ramp recipe

## Why

An Account owner needs to generate the approved reconstruction automatically. They can obtain canonical geometry without manual modeling.

## Capabilities

- **CAP-1**
  - **intent:** Generate canonical geometry from the exact approved evidence plan.
  - **success:** Given an exact approved evidence plan, when native generation executes, then typed finite parameters, original-unit conversions, acyclic operations, semantic features and generator/toolchain digests produce retained BREP/STEP snapshots.

- **CAP-2**
  - **intent:** Reject unapproved or unsupported geometry requests.
  - **success:** Given unapproved inputs, unsupported operations or a changed Project revision, when generation or publication is attempted, then the trusted schema and fences reject it; models cannot supply executable scripts and extending geometry requires reviewed generator code.

- **CAP-3**
  - **intent:** Retain the complete recipe and its source-to-geometry provenance.
  - **success:** Given a successful canonical result, when its version is recorded, then recipe, settings, dependencies and source-to-parameter provenance remain authoritative in millimetres/right-handed/Z-up; STEP alone is not the recipe.

- **CAP-4**
  - **intent:** Notify the recipient when generation completes or fails.
  - **success:** Given generation that completes or fails, when the Job commits the outcome, then one durable notification event is registered with Story 2.10 for the recipient, carrying an exact authorized target.

- **CAP-5**
  - **intent:** Keep the pinned generator image and lock available for existing Model Versions.
  - **success:** Given a Model Version whose generator image and lock are retained, when the toolchain is upgraded and a Job pinned to the old toolchain resumes, then the old image and lock remain available and the Job never resumes against the upgraded generator.

- **CAP-6**
  - **intent:** Produce equivalent versions from identical approved inputs.
  - **success:** Given identical approved inputs and a pinned toolchain, when generation runs twice, then the two Model Versions are equivalent within the R-2 tolerance (a comparator fixture until Story 4.3).

All [acceptance criteria](acceptance-criteria.md) apply to the complete story.

## Constraints

- This story implements the declared slice after its listed dependencies; it does not absorb unrelated parent capabilities.
- The [implementation constraints](implementation-constraints.md) and recursively adopted parent contract are mandatory, including ratified overrides to older source wording.
- Existing product decisions remain binding. Spec completion does not establish implementation, device support or engineering-gate acceptance.

## Non-goals

- Implementing unassigned later-story behavior or creating all future domain entities in advance.
- Adding manual mesh editing, public registration, printer control or commercial storefront behavior.

## Success signal

Typed finite parameters, original-unit conversions, acyclic operations, semantic features and generator/toolchain digests produce retained BREP/STEP snapshots. The exact criteria demonstrate the complete story outcome and its failure boundaries; any gate-status change requires actual qualification evidence.

## Assumptions

- Story boundaries and ordering are delegated fast-path planning choices; they do not claim separate user approval. Detailed shared assumptions remain in the constraints companion.
