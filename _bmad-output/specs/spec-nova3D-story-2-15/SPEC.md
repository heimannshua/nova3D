---
id: SPEC-nova3D-story-2-15
status: final
companions:
- acceptance-criteria.md
- implementation-constraints.md
- ../spec-nova3D/SPEC.md
sources:
- ../../planning-artifacts/story-inputs/story-2-15.json
---

# Story 2.15: Request a payment from an Account

## Why

An Administrator needs to ask a chosen user to pay a chosen amount for a chosen credit. they decide who pays and how much.

## Capabilities

- **CAP-1**
  - **intent:** An Administrator can ask a chosen user to pay a chosen amount for a chosen credit.
  - **success:** It is stored pending and immutable, an audit event is written and the owner is notified; without a marker it is refused.

All [acceptance criteria](acceptance-criteria.md) apply to the complete story.

## Constraints

- This story implements the declared slice after its listed dependencies; it does not absorb unrelated parent capabilities.
- The [implementation constraints](implementation-constraints.md) and recursively adopted parent contract are mandatory, including ratified overrides to older source wording.
- Existing product decisions remain binding. Spec completion does not establish implementation, device support or engineering-gate acceptance.

## Non-goals

- Implementing unassigned later-story behavior or creating all future domain entities in advance.
- Adding manual mesh editing, public registration, printer control or commercial storefront behavior.

## Success signal

It is stored pending and immutable, an audit event is written and the owner is notified; without a marker it is refused. The exact criteria demonstrate the complete story outcome and its failure boundaries; any gate-status change requires actual qualification evidence.

## Assumptions

- Story boundaries and ordering are delegated fast-path planning choices; they do not claim separate user approval. Detailed shared assumptions remain in the constraints companion.
