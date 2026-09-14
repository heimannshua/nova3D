# Acceptance Criteria

**Story 5.5: Approve the exact inspected model**

**Epic 5: Correct, compare and approve exact model versions.** Users can request evidence corrections, regenerate only affected geometry, restore history and approve the exact model they inspected.

As an Account owner,
I want to approve or reject the model I inspected,
So that export cannot use a different candidate.

**Requirement IDs:** FR-23, FR-27, AR-4, AR-5, NFR-3, UX-DR16, UX-DR57

## Dependencies

- [4.6](../spec-nova3D-story-4-6/SPEC.md)
- [5.3](../spec-nova3D-story-5-3/SPEC.md)

## Scope

- Bind Model Approval to immutable version and canonical recipe/snapshot digest with approver/time.

## Acceptance Criteria

### AC-1

**Given** a model not yet inspected or changed since inspection
**When** approval is attempted
**Then** approval is blocked and the exact required inspection is identified

### AC-2

**Given** an inspected unchanged candidate
**When** the user approves or rejects
**Then** the exact version/digest, actor, time and outcome are retained immutably

### AC-3

**Given** a successor, consequential repair or personalization change
**When** export authority is queried
**Then** old approval cannot authorize the changed candidate and renewed inspection/approval is required

## Engineering Gates

This story has no separate gate ID; applicable project-wide gates still govern acceptance.

These are acceptance obligations, not claims that the implementation or qualification has passed.
