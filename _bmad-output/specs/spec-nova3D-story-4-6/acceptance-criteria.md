# Acceptance Criteria

**Story 4.6: Inspect progressive read-only models**

**Epic 4: Generate and inspect traceable canonical geometry.** Approved evidence recipes produce immutable models whose features remain linked to evidence and inspectable without changing manufacturing authority.

As an Account owner,
I want to inspect shape and exact dimensions,
So that I can understand the model on phone or computer.

**Requirement IDs:** FR-18, AR-9, AR-24, NFR-10, SC-3, SC-7, UX-DR2, UX-DR3, UX-DR4, UX-DR15, UX-DR49

## Dependencies

- [4.5](../spec-nova3D-story-4-5/SPEC.md)

## Scope

- Implement rotate/pan/zoom/fit/reset, standard and section views, hide/isolate, selection and canonical measurement.
- Use semantic coarse/full GLB derivatives with explicit mm/Z-up to metres/Y-up transforms.

## Acceptance Criteria

### AC-1

**Given** a model with canonical dimensions
**When** view and measurement controls are used by touch or keyboard
**Then** all required inspection actions operate and dimensions use canonical geometry or labeled exact records rather than pixels

### AC-2

**Given** coarse and full derivatives
**When** LOD switches
**Then** semantic feature/evidence selection is preserved atomically while preview transformations never alter manufacturing content

### AC-3

**Given** GPU/WebGL loss or a degraded preview
**When** inspection falls back
**Then** static views and semantic feature/evidence/dimension lists remain usable without claiming a passed interactive 3D benchmark

## Engineering Gates

G-5.

These are acceptance obligations, not claims that the implementation or qualification has passed.
