# Acceptance Criteria

**Story 4.2: Generate the approved altar and ramp recipe**

**Epic 4: Generate and inspect traceable canonical geometry.** Approved evidence recipes produce immutable models whose features remain linked to evidence and inspectable without changing manufacturing authority.

As an Account owner,
I want to generate the approved reconstruction automatically,
So that I can obtain canonical geometry without manual modeling.

**Requirement IDs:** FR-15, FR-16, AR-2, AR-8, AR-9, NFR-3, NFR-6, FR-7

## Dependencies

- [3.5](../spec-nova3D-story-3-5/SPEC.md)
- [4.1](../spec-nova3D-story-4-1/SPEC.md)
- [2.10](../spec-nova3D-story-2-10/SPEC.md)

## Scope

- Implement trusted declarative subject recipe and pinned native CadQuery worker for the evidence-backed altar/ramp fixture.
- Declare in the domain package the base face, the personalization surfaces and the pinned source registry; Josh approves the G-1 corpus before the qualification run is recorded.
- Emit a ModelVersionCommitted outbox event from the shared Model Version commit that every producer uses (Stories 4.4, 5.2, 6.4 successors and 7.4 imports). The generator schema accepts optional failed print constraints (check, measured value, required value, feature references) for the constrained regeneration of Story 6.5.
- Store with every Model Version the exact bounding box of the solid in the declared default print orientation (exact rationals in millimetres), which the print-frame function of Story 4.3 reads. Retain the generator image digest and dependency lock for every non-deleted Model Version. Define the regression corpus (the approved G-1 fixture set) in the repository before acceptance.

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

### AC-4

**Given** generation that completes or fails
**When** the Job commits the outcome
**Then** one durable notification event is registered with Story 2.10 for the recipient, carrying an exact authorized target

### AC-5

**Given** a Model Version whose generator image and lock are retained
**When** the toolchain is upgraded and a Job pinned to the old toolchain resumes
**Then** the old image and lock remain available and the Job never resumes against the upgraded generator

### AC-6

**Given** identical approved inputs and a pinned toolchain
**When** generation runs twice
**Then** the two Model Versions are equivalent within the R-2 tolerance (a comparator fixture until Story 4.3)

## Engineering Gates

G-1.

These are acceptance obligations, not claims that the implementation or qualification has passed.
