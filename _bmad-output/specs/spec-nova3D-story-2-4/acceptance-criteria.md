# Acceptance Criteria

**Story 2.4: Set accountable usage limits**

**Epic 2: Confirm requests and control background spending.** Users can submit text or ordered pictures, authorize the exact work and costs, and follow durable jobs without losing approved state, and invited users can pay for extra spending credit.

As an Administrator,
I want to inspect and control paid usage,
So that spending stays within my allowance.

**Requirement IDs:** FR-4, AR-16, NFR-9, UX-DR71

## Dependencies

- [1.5](../spec-nova3D-story-1-5/SPEC.md)

## Scope

- Create immutable USD usage periods and Administrator limit controls; show settled usage, outstanding reservations and available allowance.
- Reservations begin with Story 2.6, so reservation figures are fixture-backed until then.

## Acceptance Criteria

### AC-1

**Given** a new Account allowance period
**When** defaults are initialized
**Then** invitees receive $25 and the Administrator $50 per UTC month, recorded in integer USD microdollars

### AC-2

**Given** outstanding liabilities and existing settlements
**When** a fresh-authenticated Administrator resets or changes a limit
**Then** the new period carries liabilities without rewriting history; already reserved work retains its reservation; an immutable audit event records the actor, time and old and new limits

### AC-3

**Given** an allowance at or above 80% of its period limit, or reached
**When** usage is displayed
**Then** settled, reserved and available amounts reconcile; new paid work is blocked when insufficient while disable still revokes active work; usage is readable on phone and desktop

### AC-4

**Given** a limit change without a fresh administration marker
**When** it is submitted
**Then** it is refused with the step-up offered

## Engineering Gates

This story has no separate gate ID; applicable project-wide gates still govern acceptance.

These are acceptance obligations, not claims that the implementation or qualification has passed.
