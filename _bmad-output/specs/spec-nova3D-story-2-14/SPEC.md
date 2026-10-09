---
id: SPEC-nova3D-story-2-14
status: final
companions:
- acceptance-criteria.md
- implementation-constraints.md
- ../spec-nova3D/SPEC.md
sources:
- ../../planning-artifacts/story-inputs/story-2-14.json
---

# Story 2.14: Hold prepaid credit beside the monthly allowance

## Why

An Account owner needs to have the credit they paid for kept apart from their monthly allowance. What they paid for is spent only on their work and never disappears at month end.

## Capabilities

- **CAP-1**
  - **intent:** An Account owner can have the credit they paid for kept apart from their monthly allowance.
  - **success:** $2 comes from the allowance and $1 from credit, the split is recorded, and concurrent reservations cannot exceed allowance plus credit.

All [acceptance criteria](acceptance-criteria.md) apply to the complete story.

## Constraints

- This story implements the declared slice after its listed dependencies; it does not absorb unrelated parent capabilities.
- The [implementation constraints](implementation-constraints.md) and recursively adopted parent contract are mandatory, including ratified overrides to older source wording.
- Existing product decisions remain binding. Spec completion does not establish implementation, device support or engineering-gate acceptance.

## Non-goals

- Implementing unassigned later-story behavior or creating all future domain entities in advance.
- Adding manual mesh editing, public registration, printer control or commercial storefront behavior.

## Success signal

$2 comes from the allowance and $1 from credit, the split is recorded, and concurrent reservations cannot exceed allowance plus credit. The exact criteria demonstrate the complete story outcome and its failure boundaries; any gate-status change requires actual qualification evidence.

## Assumptions

- Story boundaries and ordering are delegated fast-path planning choices; they do not claim separate user approval. Detailed shared assumptions remain in the constraints companion.
