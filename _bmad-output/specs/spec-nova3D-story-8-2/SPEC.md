---
id: SPEC-nova3D-story-8-2
status: final
companions:
- acceptance-criteria.md
- implementation-constraints.md
- ../spec-nova3D/SPEC.md
sources:
- ../../planning-artifacts/story-inputs/story-8-2.json
---

# Story 8.2: Delete an Account or close the instance

## Why

An Account owner or sole Administrator within the applicable authority needs to remove their Workspace or close the service. All authorized private targets enter the deletion process.

## Capabilities

- **CAP-1**
  - **intent:** An Account owner or sole Administrator within the applicable authority can remove their Workspace or close the service.
  - **success:** Sessions revoke and all owned private targets, jobs and pending work enter the durable deletion manifest.

All [acceptance criteria](acceptance-criteria.md) apply to the complete story.

## Constraints

- This story implements the declared slice after its listed dependencies; it does not absorb unrelated parent capabilities.
- The [implementation constraints](implementation-constraints.md) and recursively adopted parent contract are mandatory, including ratified overrides to older source wording.
- Existing product decisions remain binding. Spec completion does not establish implementation, device support or engineering-gate acceptance.

## Non-goals

- Implementing unassigned later-story behavior or creating all future domain entities in advance.
- Adding manual mesh editing, public registration, printer control or commercial storefront behavior.

## Success signal

Sessions revoke and all owned private targets, jobs and pending work enter the durable deletion manifest. The exact criteria demonstrate the complete story outcome and its failure boundaries; any gate-status change requires actual qualification evidence.

## Assumptions

- Story boundaries and ordering are delegated fast-path planning choices; they do not claim separate user approval. Detailed shared assumptions remain in the constraints companion.
