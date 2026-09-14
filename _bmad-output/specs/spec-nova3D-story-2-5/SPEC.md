---
id: SPEC-nova3D-story-2-5
status: final
companions:
- acceptance-criteria.md
- implementation-constraints.md
- ../spec-nova3D/SPEC.md
sources:
- ../../planning-artifacts/story-inputs/story-2-5.json
---

# Story 2.5: Disclose and authorize provider categories

## Why

An Account owner needs to approve each billable purpose and data transfer. Paid work uses only the data and maximum they permitted.

## Capabilities

- **CAP-1**
  - **intent:** An Account owner can approve each billable purpose and data transfer.
  - **success:** Provider, purpose, outbound-data categories, retention limitations and maximum are disclosed before explicit permission.

All [acceptance criteria](acceptance-criteria.md) apply to the complete story.

## Constraints

- This story implements the declared slice after its listed dependencies; it does not absorb unrelated parent capabilities.
- The [implementation constraints](implementation-constraints.md) and recursively adopted parent contract are mandatory, including ratified overrides to older source wording.
- Existing product decisions remain binding. Spec completion does not establish implementation, device support or engineering-gate acceptance.

## Non-goals

- Implementing unassigned later-story behavior or creating all future domain entities in advance.
- Adding manual mesh editing, public registration, printer control or commercial storefront behavior.

## Success signal

Provider, purpose, outbound-data categories, retention limitations and maximum are disclosed before explicit permission. The exact criteria demonstrate the complete story outcome and its failure boundaries; any gate-status change requires actual qualification evidence.

## Assumptions

- Story boundaries and ordering are delegated fast-path planning choices; they do not claim separate user approval. Detailed shared assumptions remain in the constraints companion.
