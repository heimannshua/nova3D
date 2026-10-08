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
- [2.13](../spec-nova3D-story-2-13/SPEC.md)

## Scope

- After scope confirmation present independent payment and cache/fresh choices; dispatch pins these choices.
- The payment choice has two states, Free (governing sources only) and Paid expansion. Choosing Paid expansion reveals the search and synthesis/vision permissions of Story 2.5 as separate, default-off disclosures; with neither granted the Project behaves as free mode. Free mode always runs first, and paid categories apply to its unresolved items.

## Acceptance Criteria

### AC-1

**Given** a confirmed evidence request
**When** research settings open
**Then** free/paid and reuse/fresh are separate controls following scope confirmation; both controls work on phone and desktop

### AC-2

**Given** a reusable eligible revision (a fixture until Story 3.6 admits real ones)
**When** reuse is selected
**Then** the original immutable revision/date is shown without a freshness or re-verification claim

### AC-3

**Given** fresh research, missing permission or insufficient allowance
**When** start is attempted
**Then** fresh work cannot silently substitute cached conclusions, and missing paid authority blocks dispatch

## Engineering Gates

This story has no separate gate ID; applicable project-wide gates still govern acceptance.

These are acceptance obligations, not claims that the implementation or qualification has passed.
