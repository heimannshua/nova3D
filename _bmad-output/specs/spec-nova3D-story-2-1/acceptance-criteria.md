# Acceptance Criteria

**Story 2.1: Confirm natural-language intent and personalization**

**Epic 2: Confirm requests and control background spending.** Users can submit text or ordered pictures, authorize the exact work and costs, and follow durable jobs without losing approved state.

As an Account owner,
I want to describe the desired model and personal additions,
So that work starts from my confirmed intent.

**Requirement IDs:** FR-5, FR-17, AR-4, SC-1, UX-DR8, UX-DR31, UX-DR32, UX-DR36

## Dependencies

- [1.7](../spec-nova3D-story-1-7/SPEC.md)

## Scope

- Persist immutable subject, scope, outcome, mode and optional user-added personalization; clarify ambiguity before research.

## Acceptance Criteria

### AC-1

**Given** an ambiguous or invalid description
**When** the user submits it
**Then** clarifications or actionable field errors appear before any research or paid step

### AC-2

**Given** an understood request
**When** the user edits and confirms it
**Then** the exact revision records subject, scope, outcome and distinct personalization

### AC-3

**Given** no scope confirmation
**When** start is requested
**Then** no Job begins and scope confirmation is not mistaken for Plan Approval or paid permission

## Engineering Gates

This story has no separate gate ID; applicable project-wide gates still govern acceptance.

These are acceptance obligations, not claims that the implementation or qualification has passed.
