---
id: SPEC-nova3D-story-2-4
status: final
companions:
- acceptance-criteria.md
- implementation-constraints.md
- ../spec-nova3D/SPEC.md
sources:
- ../../planning-artifacts/story-inputs/story-2-4.json
---

# Story 2.4: Set accountable usage limits

## Why

The Administrator needs to inspect and control paid usage. Spending stays within their allowance.

## Capabilities

- **CAP-1**
  - **intent:** The Administrator can inspect and control paid usage.
  - **success:** Invitees receive $25 and the Administrator $50 per UTC month, recorded in integer USD microdollars.

All [acceptance criteria](acceptance-criteria.md) apply to the complete story.

## Constraints

- This story implements the declared slice after its listed dependencies; it does not absorb unrelated parent capabilities.
- The [implementation constraints](implementation-constraints.md) and recursively adopted parent contract are mandatory, including ratified overrides to older source wording.
- Existing product decisions remain binding. Spec completion does not establish implementation, device support or engineering-gate acceptance.

## Non-goals

- Implementing unassigned later-story behavior or creating all future domain entities in advance.
- Adding manual mesh editing, public registration, printer control or commercial storefront behavior.

## Success signal

Invitees receive $25 and the Administrator $50 per UTC month, recorded in integer USD microdollars. The exact criteria demonstrate the complete story outcome and its failure boundaries; any gate-status change requires actual qualification evidence.

## Assumptions

- Story boundaries and ordering are delegated fast-path planning choices; they do not claim separate user approval. Detailed shared assumptions remain in the constraints companion.
