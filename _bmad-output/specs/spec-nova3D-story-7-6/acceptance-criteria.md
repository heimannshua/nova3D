# Acceptance Criteria

**Story 7.6: Qualify and recover direct models through the shared lineage**

**Epic 7: Create direct models offline and synchronize safely.** Prepared supported devices can create honestly labeled image-derived models offline, preserve them locally and synchronize without privacy or history loss.

As an Account owner,
I want to validate and export an image-derived model,
So that direct mode receives the same model and print gates.

**Requirement IDs:** FR-23, FR-24, FR-25, FR-26, FR-27, FR-28, FR-29, AR-4, AR-12, AR-13, AR-22, SC-1, SC-2, UX-DR17, UX-DR57, UX-DR61, UX-DR62, UX-DR63

## Dependencies

- [7.3](../spec-nova3D-story-7-3/SPEC.md)
- [7.5](../spec-nova3D-story-7-5/SPEC.md)
- [6.5](../spec-nova3D-story-6-5/SPEC.md)
- [6.9](../spec-nova3D-story-6-9/SPEC.md)

## Scope

- Integrate direct snapshots with online exact-model approval, print validation and the existing full-regeneration slot.

## Acceptance Criteria

### AC-1

**Given** a synchronized direct candidate
**When** qualified export is requested
**Then** connection, trusted exact-model approval and all required profile checks are enforced; local labels or approvals do not establish server authority

### AC-2

**Given** failed local repair and an unused shared lineage slot
**When** direct reconversion is dispatched
**Then** the unique slot and successor Job/outbox commit atomically using pinned original images/scope/engine, failed print constraints and a new settings digest

### AC-3

**Given** an incapable engine, consumed slot or completed reconversion
**When** recovery finishes
**Then** failure stops without resetting lineage; success preserves the original and returns a new version to inspection/approval/full validation with honest direct provenance

## Engineering Gates

G-3, G-8.

These are acceptance obligations, not claims that the implementation or qualification has passed.
