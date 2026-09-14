# Acceptance Criteria

**Story 3.5: Approve one complete immutable Research Plan**

**Epic 3: Research and approve a complete evidence plan.** Users can inspect authoritative evidence, control source eligibility, resolve interpretations and approve one complete reconstruction plan.

As an Account owner,
I want to approve the complete plan once,
So that evidence-backed geometry follows my exact decisions.

**Requirement IDs:** FR-12, FR-13, AR-4, AR-5, AR-6, UX-DR16, UX-DR44, UX-DR48

## Dependencies

- [3.3](../spec-nova3D-story-3-3/SPEC.md)
- [3.4](../spec-nova3D-story-3-4/SPEC.md)

## Scope

- Group section evidence for review while retaining one whole-Project approval gate.

## Acceptance Criteria

### AC-1

**Given** an incomplete plan or unsettled required choice
**When** approval or partial-section generation is requested
**Then** both are blocked even when some sections appear clear

### AC-2

**Given** a complete checklist and independent gap pass
**When** the user approves the whole plan
**Then** the immutable exact digest, approver/time, choices and affected details are recorded

### AC-3

**Given** a successor interpretation or policy-driven draft
**When** generation authority is checked
**Then** the successor needs renewed approval; previous approved records remain immutable and do not authorize changed content

## Engineering Gates

This story has no separate gate ID; applicable project-wide gates still govern acceptance.

These are acceptance obligations, not claims that the implementation or qualification has passed.
