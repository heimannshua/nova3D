---
id: SPEC-nova3D-story-6-10
status: final
companions:
- acceptance-criteria.md
- implementation-constraints.md
- ../spec-nova3D/SPEC.md
sources:
- ../../planning-artifacts/story-inputs/story-6-10.json
---

# Story 6.10: Produce the canonical manufacturing mesh

## Why

An Account owner needs to have the printable mesh made from the exact model they approved. Validation and export always use the same authoritative geometry.

## Capabilities

- **CAP-1**
  - **intent:** An Account owner can have the printable mesh made from the exact model they approved.
  - **success:** It derives from the canonical solid at the pinned scale and orientation with recorded tessellation settings and tool identities, and is published as a manifest; the tessellated mesh's bounds are checked against the profile cube.

All [acceptance criteria](acceptance-criteria.md) apply to the complete story.

## Constraints

- This story implements the declared slice after its listed dependencies; it does not absorb unrelated parent capabilities.
- The [implementation constraints](implementation-constraints.md) and recursively adopted parent contract are mandatory, including ratified overrides to older source wording.
- Existing product decisions remain binding. Spec completion does not establish implementation, device support or engineering-gate acceptance.

## Non-goals

- Implementing unassigned later-story behavior or creating all future domain entities in advance.
- Adding manual mesh editing, public registration, printer control or commercial storefront behavior.

## Success signal

It derives from the canonical solid at the pinned scale and orientation with recorded tessellation settings and tool identities, and is published as a manifest; the tessellated mesh's bounds are checked against the profile cube. The exact criteria demonstrate the complete story outcome and its failure boundaries; any gate-status change requires actual qualification evidence.

## Assumptions

- Story boundaries and ordering are delegated fast-path planning choices; they do not claim separate user approval. Detailed shared assumptions remain in the constraints companion.
