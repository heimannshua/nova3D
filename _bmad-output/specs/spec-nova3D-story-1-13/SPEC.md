---
id: SPEC-nova3D-story-1-13
status: final
companions:
- acceptance-criteria.md
- implementation-constraints.md
- ../spec-nova3D/SPEC.md
sources:
- ../../planning-artifacts/story-inputs/story-1-13.json
---

# Story 1.13: Raise operational alarms

## Why

An Administrator needs to be told when something stops working. Failures and silent stalls do not go unnoticed.

## Capabilities

- **CAP-1**
  - **intent:** An Administrator can be told when something stops working.
  - **success:** One alarm record is created, shown on the operations page on phone and desktop and emailed once per condition per 24 hours, and clearing the condition marks it resolved without deleting history.

All [acceptance criteria](acceptance-criteria.md) apply to the complete story.

## Constraints

- This story implements the declared slice after its listed dependencies; it does not absorb unrelated parent capabilities.
- The [implementation constraints](implementation-constraints.md) and recursively adopted parent contract are mandatory, including ratified overrides to older source wording.
- Existing product decisions remain binding. Spec completion does not establish implementation, device support or engineering-gate acceptance.

## Non-goals

- Implementing unassigned later-story behavior or creating all future domain entities in advance.
- Adding manual mesh editing, public registration, printer control or commercial storefront behavior.

## Success signal

One alarm record is created, shown on the operations page on phone and desktop and emailed once per condition per 24 hours, and clearing the condition marks it resolved without deleting history. The exact criteria demonstrate the complete story outcome and its failure boundaries; any gate-status change requires actual qualification evidence.

## Assumptions

- Story boundaries and ordering are delegated fast-path planning choices; they do not claim separate user approval. Detailed shared assumptions remain in the constraints companion.
