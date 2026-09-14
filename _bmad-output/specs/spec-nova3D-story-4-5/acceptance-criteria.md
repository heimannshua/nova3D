# Acceptance Criteria

**Story 4.5: Navigate reciprocal model and evidence links**

**Epic 4: Generate and inspect traceable canonical geometry.** Approved evidence recipes produce immutable models whose features remain linked to evidence and inspectable without changing manufacturing authority.

As an Account owner,
I want to move between a feature and its evidence,
So that I can inspect what justifies each consequential shape.

**Requirement IDs:** FR-19, AR-5, AR-9, NFR-3, UX-DR7, UX-DR50, UX-DR51

## Dependencies

- [4.2](../spec-nova3D-story-4-2/SPEC.md)
- [4.4](../spec-nova3D-story-4-4/SPEC.md)

## Scope

- Expose stable logical feature IDs with version-specific claim/parameter bindings and reciprocal navigation.

## Acceptance Criteria

### AC-1

**Given** an evidence-backed feature
**When** it is selected
**Then** exact Source/Claim, status, options, governing approval and affected geometry are visible

### AC-2

**Given** a governing claim with one or many features
**When** it is selected
**Then** every affected feature is revealed with no orphaned links in the regression corpus

### AC-3

**Given** a disabled source or unavailable preview
**When** existing provenance is opened
**Then** approved history stays immutable and evidence/feature lists remain accessible with the proper warning

## Engineering Gates

G-4.

These are acceptance obligations, not claims that the implementation or qualification has passed.
