# Acceptance Criteria

**Story 4.2: Generate the approved altar and ramp recipe**

**Epic 4: Generate and inspect traceable canonical geometry.** Approved evidence recipes produce immutable models whose features remain linked to evidence and inspectable without changing manufacturing authority.

As an Account owner,
I want to generate the approved reconstruction automatically,
So that I can obtain canonical geometry without manual modeling.

**Requirement IDs:** FR-15, FR-16, AR-2, AR-8, AR-9, NFR-3, NFR-6

## Dependencies

- [3.5](../spec-nova3D-story-3-5/SPEC.md)
- [4.1](../spec-nova3D-story-4-1/SPEC.md)

## Scope

- Implement trusted declarative subject recipe and pinned native CadQuery worker for the evidence-backed altar/ramp fixture.

## Acceptance Criteria

### AC-1

**Given** an exact approved evidence plan
**When** native generation executes
**Then** typed finite parameters, original-unit conversions, acyclic operations, semantic features and generator/toolchain digests produce retained BREP/STEP snapshots

### AC-2

**Given** unapproved inputs, unsupported operations or a changed Project revision
**When** generation or publication is attempted
**Then** the trusted schema and fences reject it; models cannot supply executable scripts and extending geometry requires reviewed generator code

### AC-3

**Given** a successful canonical result
**When** its version is recorded
**Then** recipe, settings, dependencies and source-to-parameter provenance remain authoritative in millimetres/right-handed/Z-up; STEP alone is not the recipe

## Engineering Gates

G-1.

These are acceptance obligations, not claims that the implementation or qualification has passed.
