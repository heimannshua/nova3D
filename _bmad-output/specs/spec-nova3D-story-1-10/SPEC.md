---
id: SPEC-nova3D-story-1-10
status: final
companions:
- acceptance-criteria.md
- implementation-constraints.md
- ../spec-nova3D/SPEC.md
sources:
- ../../planning-artifacts/story-inputs/story-1-10.json
---

# Story 1.10: Provision external accounts, credentials and spend limits

## Why

An Administrator needs to have every external account, credential and spend limit created, recorded and checked for each environment. No later story stalls on an account only they can create.

## Capabilities

- **CAP-1**
  - **intent:** An Administrator can have every external account, credential and spend limit created, recorded and checked for each environment.
  - **success:** Each service names an owner, plan, region, spend backstop, first-needed story, verification kind and per-environment secret names, and the free-tier limits relied on are recorded with the trigger for upgrading.

All [acceptance criteria](acceptance-criteria.md) apply to the complete story.

## Constraints

- This story implements the declared slice after its listed dependencies; it does not absorb unrelated parent capabilities.
- The [implementation constraints](implementation-constraints.md) and recursively adopted parent contract are mandatory, including ratified overrides to older source wording.
- Existing product decisions remain binding. Spec completion does not establish implementation, device support or engineering-gate acceptance.

## Non-goals

- Implementing unassigned later-story behavior or creating all future domain entities in advance.
- Adding manual mesh editing, public registration, printer control or commercial storefront behavior.

## Success signal

Each service names an owner, plan, region, spend backstop, first-needed story, verification kind and per-environment secret names, and the free-tier limits relied on are recorded with the trigger for upgrading. The exact criteria demonstrate the complete story outcome and its failure boundaries; any gate-status change requires actual qualification evidence.

## Assumptions

- Story boundaries and ordering are delegated fast-path planning choices; they do not claim separate user approval. Detailed shared assumptions remain in the constraints companion.
