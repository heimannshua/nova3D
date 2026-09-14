---
id: SPEC-nova3D-story-1-5
status: final
companions:
- acceptance-criteria.md
- implementation-constraints.md
- ../spec-nova3D/SPEC.md
sources:
- ../../planning-artifacts/story-inputs/story-1-5.json
---

# Story 1.5: Disable and re-enable account access

## Why

The Administrator needs to disable an invited Account. They can revoke access without deleting its work.

## Capabilities

- **CAP-1**
  - **intent:** The Administrator can disable an invited Account.
  - **success:** Session/download authority and commit epochs revoke atomically before cancellation signals, while its Workspace is retained.

All [acceptance criteria](acceptance-criteria.md) apply to the complete story.

## Constraints

- This story implements the declared slice after its listed dependencies; it does not absorb unrelated parent capabilities.
- The [implementation constraints](implementation-constraints.md) and recursively adopted parent contract are mandatory, including ratified overrides to older source wording.
- Existing product decisions remain binding. Spec completion does not establish implementation, device support or engineering-gate acceptance.

## Non-goals

- Implementing unassigned later-story behavior or creating all future domain entities in advance.
- Adding manual mesh editing, public registration, printer control or commercial storefront behavior.

## Success signal

Session/download authority and commit epochs revoke atomically before cancellation signals, while its Workspace is retained. The exact criteria demonstrate the complete story outcome and its failure boundaries; any gate-status change requires actual qualification evidence.

## Assumptions

- Story boundaries and ordering are delegated fast-path planning choices; they do not claim separate user approval. Detailed shared assumptions remain in the constraints companion.
