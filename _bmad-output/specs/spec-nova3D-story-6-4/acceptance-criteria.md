# Acceptance Criteria

**Story 6.4: Perform bounded local repair with equivalence proof**

**Epic 6: Qualify and export an evidence-backed printable model.** An approved model can pass exact profile checks, receive bounded audited repair and be downloaded with immutable bilingual provenance.

As an Account owner,
I want to repair fixable defects automatically,
So that small repairs preserve approved shape and larger changes return for review.

**Requirement IDs:** FR-26, FR-27, AR-10, AR-12, NFR-3, UX-DR17, UX-DR60

## Dependencies

- [6.3](../spec-nova3D-story-6-3/SPEC.md)
- [4.3](../spec-nova3D-story-4-3/SPEC.md)

## Scope

- Create a new artifact for every byte change and audit the allowed local repair attempt before rerunning checks.

## Acceptance Criteria

### AC-1

**Given** normals/winding, duplicate/zero-area faces or weldable vertices
**When** local repair runs
**Then** the repaired artifact is recorded and may retain Model Version only when certified canonical-to-repaired equivalence proves no consequential change

### AC-2

**Given** hole filling, remeshing, thickening or dimensional change
**When** repair is proposed or performed
**Then** it is consequential, creates a successor Model Version and requires new inspection, exact approval and validation

### AC-3

**Given** a repair succeeds or fails
**When** its outcome is published
**Then** the target, change and proof are retained; all checks rerun and bounded failure cannot loop indefinitely

## Engineering Gates

G-3.

These are acceptance obligations, not claims that the implementation or qualification has passed.
