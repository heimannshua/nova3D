---
id: SPEC-nova3D-story-5-4
status: final
companions:
- acceptance-criteria.md
- implementation-constraints.md
- ../spec-nova3D/SPEC.md
sources:
- ../../planning-artifacts/story-inputs/story-5-4.json
---

# Story 5.4: Restore a version without silently authorizing export

## Why

An Account owner needs to return to a previous version. Restoration preserves both geometry and history.

## Capabilities

- **CAP-1**
  - **intent:** Restore the full content of a non-deleted restorable version.
  - **success:** Given a non-deleted version advertised as restorable, when restoration runs, then all geometry, parameters, governing inputs, approvals, validation and personalization restore from verified manifests.

- **CAP-2**
  - **intent:** Keep later history and reject unavailable or tombstoned content.
  - **success:** Given later versions or missing/corrupt/tombstoned content, when restore is requested, then later history is never erased and unavailable content is not reported restored or resurrected.

- **CAP-3**
  - **intent:** Recheck exact approval and validation before exporting restored work.
  - **success:** Given a restored model and a new export request, when readiness is checked, then the exact current model digest/approval and profile validation are rechecked; restoration itself grants no export authority.

All [acceptance criteria](acceptance-criteria.md) apply to the complete story.

## Constraints

- This story implements the declared slice after its listed dependencies; it does not absorb unrelated parent capabilities.
- The [implementation constraints](implementation-constraints.md) and recursively adopted parent contract are mandatory, including ratified overrides to older source wording.
- Existing product decisions remain binding. Spec completion does not establish implementation, device support or engineering-gate acceptance.

## Non-goals

- Implementing unassigned later-story behavior or creating all future domain entities in advance.
- Adding manual mesh editing, public registration, printer control or commercial storefront behavior.

## Success signal

All geometry, parameters, governing inputs, approvals, validation and personalization restore from verified manifests. The exact criteria demonstrate the complete story outcome and its failure boundaries; any gate-status change requires actual qualification evidence.

## Assumptions

- Story boundaries and ordering are delegated fast-path planning choices; they do not claim separate user approval. Detailed shared assumptions remain in the constraints companion.
