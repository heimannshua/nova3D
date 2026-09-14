# Acceptance Criteria

**Story 6.3: Validate profile-specific features and support**

**Epic 6: Qualify and export an evidence-backed printable model.** An approved model can pass exact profile checks, receive bounded audited repair and be downloaded with immutable bilingual provenance.

As an Account owner,
I want to understand thin features, clearances and support needs,
So that the export meets the adopted profile checks.

**Requirement IDs:** FR-25, AR-11, NFR-11, UX-DR17, UX-DR59

## Dependencies

- [6.2](../spec-nova3D-story-6-2/SPEC.md)

## Scope

- Implement general wall/feature/clearance/relief and verified overhang/bridge support analysis, not only the local box fixture.

## Acceptance Criteria

### AC-1

**Given** profile-specific feature fixtures
**When** validation measures them
**Then** wall ≥1.2 mm, isolated feature ≥0.8 mm, mating clearance ≥0.4 mm and raised/recessed relief ≥0.6 mm are enforced

### AC-2

**Given** an overhang >45° from vertical or a bridge >5 mm
**When** support is assessed
**Then** verified support/slicing analysis is required; unsupported or unknown analysis blocks qualified export

### AC-3

**Given** general and adversarial geometry
**When** the validator corpus runs
**Then** warnings and unknowns remain explicit with profile/time/tool identity; a successful box slice does not qualify arbitrary geometry

## Engineering Gates

G-3.

These are acceptance obligations, not claims that the implementation or qualification has passed.
