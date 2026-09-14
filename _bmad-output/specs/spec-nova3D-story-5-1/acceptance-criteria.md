# Acceptance Criteria

**Story 5.1: Research a focused correction**

**Epic 5: Correct, compare and approve exact model versions.** Users can request evidence corrections, regenerate only affected geometry, restore history and approve the exact model they inspected.

As an Account owner,
I want to explain a problem with selected features,
So that the evidence can be reconsidered without manual mesh editing.

**Requirement IDs:** FR-20, AR-5, AR-6, UX-DR16, UX-DR52, UX-DR53

## Dependencies

- [4.6](../spec-nova3D-story-4-6/SPEC.md)
- [3.7](../spec-nova3D-story-3-7/SPEC.md)

## Scope

- Link a correction to selected claims/details, preview affected dependencies and route required research through existing cost controls.

## Acceptance Criteria

### AC-1

**Given** selected consequential features
**When** a plain-language correction is submitted
**Then** the issue, affected details/dependencies and requested evidence are retained

### AC-2

**Given** new evidence changes an interpretation
**When** a correction result is produced
**Then** a successor whole plan exposes changed choices and blocks regeneration pending renewed Plan Approval

### AC-3

**Given** research finds no change or fails
**When** the result is shown
**Then** original approved state remains intact with reasons, known cost and permitted next action

## Engineering Gates

This story has no separate gate ID; applicable project-wide gates still govern acceptance.

These are acceptance obligations, not claims that the implementation or qualification has passed.
