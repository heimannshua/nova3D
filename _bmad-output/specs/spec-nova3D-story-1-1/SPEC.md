---
id: SPEC-nova3D-story-1-1
status: final
companions:
- acceptance-criteria.md
- implementation-constraints.md
- ../spec-nova3D/SPEC.md
sources:
- ../../planning-artifacts/story-inputs/story-1-1.json
---

# Story 1.1: Adopt and harden the qualified application seed

## Why

A maintainer needs a reproducible application startup. Implementation starts from the qualified runtime.

## Capabilities

- **CAP-1**
  - **intent:** A maintainer can use a reproducible application startup.
  - **success:** The lockfile records the adopted versions, `engines` allows Node 24 (Vercel supplies the patch release) and CI pins 24.21.0, build-only tooling is not a runtime dependency, the bundler choice is recorded with its qualification evidence, and a loopback production page responds successfully; CI runs the unit, integration and browser suites against the local stack.

All [acceptance criteria](acceptance-criteria.md) apply to the complete story.

## Constraints

- This story implements the declared slice after its listed dependencies; it does not absorb unrelated parent capabilities.
- The [implementation constraints](implementation-constraints.md) and recursively adopted parent contract are mandatory, including ratified overrides to older source wording.
- Existing product decisions remain binding. Spec completion does not establish implementation, device support or engineering-gate acceptance.

## Non-goals

- Implementing unassigned later-story behavior or creating all future domain entities in advance.
- Adding manual mesh editing, public registration, printer control or commercial storefront behavior.

## Success signal

The lockfile records the adopted versions, `engines` allows Node 24 (Vercel supplies the patch release) and CI pins 24.21.0, build-only tooling is not a runtime dependency, the bundler choice is recorded with its qualification evidence, and a loopback production page responds successfully; CI runs the unit, integration and browser suites against the local stack. The exact criteria demonstrate the complete story outcome and its failure boundaries; any gate-status change requires actual qualification evidence.

## Assumptions

- Story boundaries and ordering are delegated fast-path planning choices; they do not claim separate user approval. Detailed shared assumptions remain in the constraints companion.
