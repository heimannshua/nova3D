# Acceptance Criteria

**Story 4.3: Certify corresponding geometry equivalence**

**Epic 4: Generate and inspect traceable canonical geometry.** Approved evidence recipes produce immutable models whose features remain linked to evidence and inspectable without changing manufacturing authority.

As an Account owner,
I want to verify that unchanged geometry stayed unchanged,
So that regeneration and minor repair cannot silently alter the model.

**Requirement IDs:** FR-16, FR-21, FR-26, AR-10, NFR-6

## Dependencies

- [4.2](../spec-nova3D-story-4-2/SPEC.md)

## Scope

- Implement a certified comparator and deliberate negative corpus independently of preview meshes.

## Acceptance Criteria

### AC-1

**Given** corresponding features under the original pinned final-print transform
**When** comparison runs with the same tessellator/settings and error-bound version
**Then** feature identity, component count and closed-solid topology match; no best-fit or independent rescaling is used

### AC-2

**Given** certified surface-distance and volume calculations
**When** equivalence is decided
**Then** bidirectional distance upper bound and bounds delta are ≤0.01 mm and relative volume delta ≤0.1% using reference absolute volume

### AC-3

**Given** dimensional, thin-feature, hole, rotation, unit, scale or tiny/zero/ill-conditioned fixtures
**When** the regression corpus runs
**Then** inconclusive or violating results fail closed; coarse bounds/volume alone and preview LOD cannot certify equivalence

## Engineering Gates

G-2.

These are acceptance obligations, not claims that the implementation or qualification has passed.
