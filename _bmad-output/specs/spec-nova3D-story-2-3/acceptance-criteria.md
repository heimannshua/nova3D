# Acceptance Criteria

**Story 2.3: Choose picture mode and acknowledge uncertainty**

**Epic 2: Confirm requests and control background spending.** Users can submit text or ordered pictures, authorize the exact work and costs, and follow durable jobs without losing approved state.

As an Account owner,
I want to choose direct conversion or evidence research,
So that I understand what the resulting geometry can claim.

**Requirement IDs:** FR-5, FR-12, FR-13, AR-4, SC-1, UX-DR8, UX-DR10, UX-DR34, UX-DR35, UX-DR36, UX-DR38

## Dependencies

- [2.1](../spec-nova3D-story-2-1/SPEC.md)
- [2.2](../spec-nova3D-story-2-2/SPEC.md)

## Scope

- Check clarity/obstruction/angle coverage and recommend useful additional views before conversion.
- Persist evidence_images versus image_direct with the appropriate confirmed-input gate.

## Acceptance Criteria

### AC-1

**Given** unclear or incomplete views
**When** quality review runs
**Then** detected blur, obstruction or missing angles and useful remedies are explained

### AC-2

**Given** incomplete direct inputs
**When** Generate anyway is selected
**Then** explicit invented/inaccurate-geometry acknowledgment is pinned to the ordered images and confirmed scope

### AC-3

**Given** a picture-mode choice or later mode change
**When** the request is confirmed
**Then** research-assisted mode requires whole-plan approval later; direct mode has no synthetic Research Plan, and mode changes create successor requests

## Engineering Gates

This story has no separate gate ID; applicable project-wide gates still govern acceptance.

These are acceptance obligations, not claims that the implementation or qualification has passed.
