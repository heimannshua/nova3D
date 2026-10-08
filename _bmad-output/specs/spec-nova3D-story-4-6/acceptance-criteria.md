# Acceptance Criteria

**Story 4.6: Inspect progressive read-only models**

**Epic 4: Generate and inspect traceable canonical geometry.** Approved evidence recipes produce immutable models whose features remain linked to evidence and inspectable without changing manufacturing authority.

As an Account owner,
I want to inspect shape and exact dimensions,
So that I can understand the model on phone or computer.

**Requirement IDs:** FR-18, AR-9, AR-24, NFR-10, SC-3, SC-7, UX-DR2, UX-DR3, UX-DR4, UX-DR15, UX-DR49

## Dependencies

- [4.5](../spec-nova3D-story-4-5/SPEC.md)
- [4.7](../spec-nova3D-story-4-7/SPEC.md)

## Scope

- Implement rotate/pan/zoom/fit/reset, standard and section views, hide/isolate, selection and canonical measurement.
- Load the coarse and then the full semantic GLB derivatives produced by Story 4.7.
- Record an immutable inspection event when the Account owner has opened the exact Model Version in the viewer and selected at least one feature with its evidence; any change to the version makes it not inspected.

## Acceptance Criteria

### AC-1

**Given** a model with canonical dimensions
**When** view and measurement controls are used by touch or keyboard
**Then** all required inspection actions operate and dimensions use canonical geometry or labeled exact records rather than pixels; the controls work on phone and desktop

### AC-2

**Given** coarse and full derivatives
**When** LOD switches
**Then** semantic feature/evidence selection is preserved atomically while preview transformations never alter manufacturing content

### AC-3

**Given** GPU/WebGL loss or a degraded preview
**When** inspection falls back
**Then** static views and semantic feature/evidence/dimension lists remain usable without claiming a passed interactive 3D benchmark

### AC-4

**Given** a user who has opened a Model Version and navigated a feature to its evidence
**When** approval is requested (a fixture request until Story 5.5 exists)
**Then** an immutable inspection event for that exact version digest exists, and a later change to the version leaves it not inspected

## Engineering Gates

G-5.

These are acceptance obligations, not claims that the implementation or qualification has passed.
