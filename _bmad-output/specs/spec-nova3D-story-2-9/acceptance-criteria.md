# Acceptance Criteria

**Story 2.9: Select research payment and freshness separately**

**Epic 2: Confirm requests and control background spending.** Users can submit text or ordered pictures, authorize the exact work and costs, and follow durable jobs without losing approved state.

As an Account owner,
I want to choose free or paid work and reuse or fresh research,
So that scope, cost and freshness stay explicit.

**Requirement IDs:** FR-14, AR-6, AR-20, UX-DR8, UX-DR37, UX-DR38

## Dependencies

- [2.5](../spec-nova3D-story-2-5/SPEC.md)
- [2.7](../spec-nova3D-story-2-7/SPEC.md)

## Scope

- After scope confirmation present independent payment and cache/fresh choices; dispatch pins these choices.

## Acceptance Criteria

### AC-1

**Given** a confirmed evidence request
**When** research settings open
**Then** free/paid and reuse/fresh are separate controls following scope confirmation

### AC-2

**Given** a reusable eligible revision
**When** reuse is selected
**Then** the original immutable revision/date is shown without a freshness or re-verification claim

### AC-3

**Given** fresh research, missing permission or insufficient allowance
**When** start is attempted
**Then** fresh work cannot silently substitute cached conclusions, and missing paid authority blocks dispatch

## Engineering Gates

This story has no separate gate ID; applicable project-wide gates still govern acceptance.

These are acceptance obligations, not claims that the implementation or qualification has passed.
