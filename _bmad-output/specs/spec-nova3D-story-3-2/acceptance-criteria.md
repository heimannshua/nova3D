# Acceptance Criteria

**Story 3.2: Control Project and Account source eligibility**

**Epic 3: Research and approve a complete evidence plan.** Users can inspect authoritative evidence, control source eligibility, resolve interpretations and approve one complete reconstruction plan.

As an Account owner,
I want to exclude a source locally or across my Projects,
So that research follows my source choices without rewriting history.

**Requirement IDs:** FR-9, FR-14, AR-6, AR-20, SC-6, UX-DR12, UX-DR43, UX-DR66, UX-DR67

## Dependencies

- [3.1](../spec-nova3D-story-3-1/SPEC.md)

## Scope

- Implement Project exclusions, Account toggles and versioned deterministic policy snapshots for research, cache adoption and plans.

## Acceptance Criteria

### AC-1

**Given** a source used in active research
**When** Project exclusion or Account disable is applied
**Then** the effective epoch changes immediately, affected draft claims/choices are reconsidered and replacement research continues with the proper scope

### AC-2

**Given** an attempt, cache adoption or Plan Revision
**When** policy is pinned
**Then** Account-policy revision, Project-exclusion revision and explicit source identity set determine eligibility and stale-epoch completion is rejected

### AC-3

**Given** a completed approved Project or re-enabled source
**When** a toggle or warning preference changes
**Then** approved records and exports remain immutable; re-enable restores future eligibility and hiding warnings changes presentation only

## Engineering Gates

This story has no separate gate ID; applicable project-wide gates still govern acceptance.

These are acceptance obligations, not claims that the implementation or qualification has passed.
