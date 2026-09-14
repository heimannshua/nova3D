---
id: SPEC-nova3D-story-6-3
status: final
companions:
- acceptance-criteria.md
- implementation-constraints.md
- ../spec-nova3D/SPEC.md
sources:
- ../../planning-artifacts/story-inputs/story-6-3.json
---

# Story 6.3: Validate profile-specific features and support

## Why

An Account owner needs to understand thin features, clearances and support needs. The export meets the adopted profile checks.

## Capabilities

- **CAP-1**
  - **intent:** Check profile-specific walls, features, clearances and relief.
  - **success:** Given profile-specific feature fixtures, when validation measures them, then wall ≥1.2 mm, isolated feature ≥0.8 mm, mating clearance ≥0.4 mm and raised/recessed relief ≥0.6 mm are enforced.

- **CAP-2**
  - **intent:** Require verified support analysis for unsupported overhangs and bridges.
  - **success:** Given an overhang >45° from vertical or a bridge >5 mm, when support is assessed, then verified support/slicing analysis is required; unsupported or unknown analysis blocks qualified export.

- **CAP-3**
  - **intent:** Report general validation honestly with warnings and unknowns.
  - **success:** Given general and adversarial geometry, when the validator corpus runs, then warnings and unknowns remain explicit with profile/time/tool identity; a successful box slice does not qualify arbitrary geometry.

All [acceptance criteria](acceptance-criteria.md) apply to the complete story.

## Constraints

- This story implements the declared slice after its listed dependencies; it does not absorb unrelated parent capabilities.
- The [implementation constraints](implementation-constraints.md) and recursively adopted parent contract are mandatory, including ratified overrides to older source wording.
- Existing product decisions remain binding. Spec completion does not establish implementation, device support or engineering-gate acceptance.

## Non-goals

- Implementing unassigned later-story behavior or creating all future domain entities in advance.
- Adding manual mesh editing, public registration, printer control or commercial storefront behavior.

## Success signal

Wall ≥1.2 mm, isolated feature ≥0.8 mm, mating clearance ≥0.4 mm and raised/recessed relief ≥0.6 mm are enforced. The exact criteria demonstrate the complete story outcome and its failure boundaries; any gate-status change requires actual qualification evidence.

## Assumptions

- Story boundaries and ordering are delegated fast-path planning choices; they do not claim separate user approval. Detailed shared assumptions remain in the constraints companion.
