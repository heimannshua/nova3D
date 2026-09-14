---
id: SPEC-nova3D-story-2-3
status: final
companions:
- acceptance-criteria.md
- implementation-constraints.md
- ../spec-nova3D/SPEC.md
sources:
- ../../planning-artifacts/story-inputs/story-2-3.json
---

# Story 2.3: Choose picture mode and acknowledge uncertainty

## Why

An Account owner needs to choose direct conversion or evidence research. They understand what the resulting geometry can claim.

## Capabilities

- **CAP-1**
  - **intent:** Understand image clarity and missing-view problems.
  - **success:** Given unclear or incomplete views, when quality review runs, then detected blur, obstruction or missing angles and useful remedies are explained.

- **CAP-2**
  - **intent:** Proceed with incomplete direct inputs only after acknowledging uncertainty.
  - **success:** Given incomplete direct inputs, when Generate anyway is selected, then explicit invented/inaccurate-geometry acknowledgment is pinned to the ordered images and confirmed scope.

- **CAP-3**
  - **intent:** Choose a picture mode with its correct approval and provenance rules.
  - **success:** Given a picture-mode choice or later mode change, when the request is confirmed, then research-assisted mode requires whole-plan approval later; direct mode has no synthetic Research Plan, and mode changes create successor requests.

All [acceptance criteria](acceptance-criteria.md) apply to the complete story.

## Constraints

- This story implements the declared slice after its listed dependencies; it does not absorb unrelated parent capabilities.
- The [implementation constraints](implementation-constraints.md) and recursively adopted parent contract are mandatory, including ratified overrides to older source wording.
- Existing product decisions remain binding. Spec completion does not establish implementation, device support or engineering-gate acceptance.

## Non-goals

- Implementing unassigned later-story behavior or creating all future domain entities in advance.
- Adding manual mesh editing, public registration, printer control or commercial storefront behavior.

## Success signal

Detected blur, obstruction or missing angles and useful remedies are explained. The exact criteria demonstrate the complete story outcome and its failure boundaries; any gate-status change requires actual qualification evidence.

## Assumptions

- Story boundaries and ordering are delegated fast-path planning choices; they do not claim separate user approval. Detailed shared assumptions remain in the constraints companion.
