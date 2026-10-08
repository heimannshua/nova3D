# Acceptance Criteria

**Story 6.10: Produce the canonical manufacturing mesh**

**Epic 6: Qualify and export an evidence-backed printable model.** An approved model can pass exact profile checks, receive bounded audited repair and be downloaded with immutable bilingual provenance.

As an Account owner,
I want to have the printable mesh made from the exact model I approved,
So that validation and export always use the same authoritative geometry.

**Requirement IDs:** FR-25, AR-9, AR-11, NFR-11

## Dependencies

- [6.1](../spec-nova3D-story-6-1/SPEC.md)
- [4.1](../spec-nova3D-story-4-1/SPEC.md)

## Scope

- Produce the manufacturing mesh from the canonical solid: apply the pinned print scale and orientation, tessellate at 0.002 mm linear and 0.1 rad angular deflection in the print frame, and publish it as a manifest root with its settings and tool versions. It is the authority that Stories 6.2 to 6.4 validate and that Story 4.3 compares; preview LODs never substitute.
- Repair children and regenerated successors reuse the lineage print scale; one that does not fit fails and is never rescaled.

## Acceptance Criteria

### AC-1

**Given** a Model Version and a pinned profile
**When** the mesh is produced
**Then** it derives from the canonical solid at the pinned scale and orientation with recorded tessellation settings and tool identities, and is published as a manifest

### AC-2

**Given** a repair child or regenerated successor
**When** its mesh is produced
**Then** it reuses the lineage print scale, and a model that no longer fits fails instead of being rescaled

### AC-3

**Given** a preview derivative
**When** it is offered as the manufacturing mesh
**Then** it is rejected

## Engineering Gates

G-3.

These are acceptance obligations, not claims that the implementation or qualification has passed.
