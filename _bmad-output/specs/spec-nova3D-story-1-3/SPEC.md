---
id: SPEC-nova3D-story-1-3
status: final
companions:
- acceptance-criteria.md
- implementation-constraints.md
- ../spec-nova3D/SPEC.md
sources:
- ../../planning-artifacts/story-inputs/story-1-3.json
---

# Story 1.3: Create invitation-only accounts

## Why

An invited user needs to register with a valid invitation. Their account starts in its own private workspace.

## Capabilities

- **CAP-1**
  - **intent:** An invited user can register with a valid invitation.
  - **success:** At most one activated Account/Workspace is created; retries return the original outcome and partial provisioning cannot sign in.

All [acceptance criteria](acceptance-criteria.md) apply to the complete story.

## Constraints

- This story implements the declared slice after its listed dependencies; it does not absorb unrelated parent capabilities.
- The [implementation constraints](implementation-constraints.md) and recursively adopted parent contract are mandatory, including ratified overrides to older source wording.
- Existing product decisions remain binding. Spec completion does not establish implementation, device support or engineering-gate acceptance.

## Non-goals

- Implementing unassigned later-story behavior or creating all future domain entities in advance.
- Adding manual mesh editing, public registration, printer control or commercial storefront behavior.

## Success signal

At most one activated Account/Workspace is created; retries return the original outcome and partial provisioning cannot sign in. The exact criteria demonstrate the complete story outcome and its failure boundaries; any gate-status change requires actual qualification evidence.

## Assumptions

- Story boundaries and ordering are delegated fast-path planning choices; they do not claim separate user approval. Detailed shared assumptions remain in the constraints companion.
