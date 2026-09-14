# Acceptance Criteria

**Story 5.4: Restore a version without silently authorizing export**

**Epic 5: Correct, compare and approve exact model versions.** Users can request evidence corrections, regenerate only affected geometry, restore history and approve the exact model they inspected.

As an Account owner,
I want to return to a previous version,
So that restoration preserves both geometry and history.

**Requirement IDs:** FR-22, AR-5, AR-9, AR-19, NFR-7, UX-DR16, UX-DR56

## Dependencies

- [5.3](../spec-nova3D-story-5-3/SPEC.md)

## Scope

- Restore verified immutable geometry and mode-appropriate provenance through a new history event.

## Acceptance Criteria

### AC-1

**Given** a non-deleted version advertised as restorable
**When** restoration runs
**Then** all geometry, parameters, governing inputs, approvals, validation and personalization restore from verified manifests

### AC-2

**Given** later versions or missing/corrupt/tombstoned content
**When** restore is requested
**Then** later history is never erased and unavailable content is not reported restored or resurrected

### AC-3

**Given** a restored model and a new export request
**When** readiness is checked
**Then** the exact current model digest/approval and profile validation are rechecked; restoration itself grants no export authority

## Engineering Gates

This story has no separate gate ID; applicable project-wide gates still govern acceptance.

These are acceptance obligations, not claims that the implementation or qualification has passed.
