# Acceptance Criteria

**Story 3.3: Account for every consequential physical detail**

**Epic 3: Research and approve a complete evidence plan.** Users can inspect authoritative evidence, control source eligibility, resolve interpretations and approve one complete reconstruction plan.

As an Account owner,
I want to see complete evidence and unresolved gaps,
So that I do not approve a reconstruction with hidden omissions.

**Requirement IDs:** FR-10, FR-11, FR-12, AR-6, NFR-3, NFR-8, UX-DR45, UX-DR46

## Dependencies

- [3.1](../spec-nova3D-story-3-1/SPEC.md)
- [3.2](../spec-nova3D-story-3-2/SPEC.md)

## Scope

- Build the finite subject-specific detail checklist, statuses and independent omission review; product FRs are not physical detail records.

## Acceptance Criteria

### AC-1

**Given** a requested reconstruction scope
**When** completeness is assessed
**Then** shape, dimensions, materials, placement, printability and historical interpretation are accounted for with evidence or explicit sourced/inferred/disputed/unknown/user-added status

### AC-2

**Given** a missing checklist item or unresolved independent-review gap
**When** plan readiness is evaluated
**Then** whole-plan approval is blocked until the gap is resolved; the separate omission pass is retained

### AC-3

**Given** uncertainty or a personal addition
**When** a detail is displayed
**Then** evidence, reasoning/confidence, expected geometry effect and honest status are visible without fabricated historical detail

## Engineering Gates

This story has no separate gate ID; applicable project-wide gates still govern acceptance.

These are acceptance obligations, not claims that the implementation or qualification has passed.
