# Acceptance Criteria

**Story 5.3: Compare immutable model history**

**Epic 5: Correct, compare and approve exact model versions.** Users can request evidence corrections, regenerate only affected geometry, restore history and approve the exact model they inspected.

As an Account owner,
I want to compare two versions and their reasons,
So that I can see what changed and why.

**Requirement IDs:** FR-22, AR-5, AR-9, NFR-3, NFR-7, UX-DR16, UX-DR54, UX-DR55

## Dependencies

- [5.2](../spec-nova3D-story-5-2/SPEC.md)

## Scope

- Present immutable history and two-version comparison for geometry, parameters, evidence, choices, personalization, approval and validation.

## Acceptance Criteria

### AC-1

**Given** two non-deleted versions
**When** comparison opens
**Then** changed and unchanged features plus every listed provenance/parameter/approval/validation dimension are distinguishable

### AC-2

**Given** an older version
**When** its details open
**Then** exact governing inputs, artifacts, activities and timestamps resolve rather than current mutable data

### AC-3

**Given** preview degradation or a restored event
**When** history is inspected
**Then** semantic differences remain readable and later history is retained

## Engineering Gates

This story has no separate gate ID; applicable project-wide gates still govern acceptance.

These are acceptance obligations, not claims that the implementation or qualification has passed.
