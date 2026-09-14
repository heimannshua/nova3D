---
id: SPEC-nova3D-story-3-5
status: final
companions:
- acceptance-criteria.md
- implementation-constraints.md
- ../spec-nova3D/SPEC.md
sources:
- ../../planning-artifacts/story-inputs/story-3-5.json
---

# Story 3.5: Approve one complete immutable Research Plan

## Why

An Account owner needs to approve the complete plan once. Evidence-backed geometry follows their exact decisions.

## Capabilities

- **CAP-1**
  - **intent:** Block incomplete plan approval and premature section generation.
  - **success:** Given an incomplete plan or unsettled required choice, when approval or partial-section generation is requested, then both are blocked even when some sections appear clear.

- **CAP-2**
  - **intent:** Approve the exact complete whole-Project plan.
  - **success:** Given a complete checklist and independent gap pass, when the user approves the whole plan, then the immutable exact digest, approver/time, choices and affected details are recorded.

- **CAP-3**
  - **intent:** Require renewed approval for changed plan content.
  - **success:** Given a successor interpretation or policy-driven draft, when generation authority is checked, then the successor needs renewed approval; previous approved records remain immutable and do not authorize changed content.

All [acceptance criteria](acceptance-criteria.md) apply to the complete story.

## Constraints

- This story implements the declared slice after its listed dependencies; it does not absorb unrelated parent capabilities.
- The [implementation constraints](implementation-constraints.md) and recursively adopted parent contract are mandatory, including ratified overrides to older source wording.
- Existing product decisions remain binding. Spec completion does not establish implementation, device support or engineering-gate acceptance.

## Non-goals

- Implementing unassigned later-story behavior or creating all future domain entities in advance.
- Adding manual mesh editing, public registration, printer control or commercial storefront behavior.

## Success signal

Both are blocked even when some sections appear clear. The exact criteria demonstrate the complete story outcome and its failure boundaries; any gate-status change requires actual qualification evidence.

## Assumptions

- Story boundaries and ordering are delegated fast-path planning choices; they do not claim separate user approval. Detailed shared assumptions remain in the constraints companion.
