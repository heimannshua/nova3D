# Acceptance Criteria

**Story 7.8: Recover direct models with one pinned reconversion**

**Epic 7: Create direct models offline and synchronize safely.** Prepared supported devices can create honestly labeled image-derived models offline, preserve them locally and synchronize without privacy or history loss.

As an Account owner,
I want to retry a failed direct model once from my original pictures,
So that a repair failure does not force me to start over, and recovery cannot loop.

**Requirement IDs:** FR-28, AR-12, AR-22, SC-1, SC-2, UX-DR17, UX-DR61

## Dependencies

- [7.6](../spec-nova3D-story-7-6/SPEC.md)
- [6.5](../spec-nova3D-story-6-5/SPEC.md)
- [2.12](../spec-nova3D-story-2-12/SPEC.md)

## Scope

- Integrate direct snapshots with the existing full-regeneration slot: one reconversion in the validation lineage using the retained original pictures, confirmed scope, original engine and the failed print constraints, with a new settings digest.

## Acceptance Criteria

### AC-1

**Given** failed local repair and an unused shared lineage slot
**When** reconversion is requested
**Then** the unique slot and the successor Job/outbox commit atomically using the pinned original pictures/scope/engine, failed print constraints and a new settings digest

### AC-2

**Given** an incapable engine, a consumed slot or a completed reconversion
**When** the outcome is recorded
**Then** failure stops without resetting the lineage, and success preserves the original and returns a new version to inspection, approval and full validation with honest direct provenance

## Engineering Gates

G-3, G-8.

These are acceptance obligations, not claims that the implementation or qualification has passed.
