# Acceptance Criteria

**Story 2.6: Reserve bounded costs atomically**

**Epic 2: Confirm requests and control background spending.** Users can submit text or ordered pictures, authorize the exact work and costs, and follow durable jobs without losing approved state.

As an Account owner,
I want to start only work with an enforceable maximum,
So that concurrent requests cannot overspend.

**Requirement IDs:** FR-4, AR-3, AR-16, NFR-5, NFR-9

## Dependencies

- [2.4](../spec-nova3D-story-2-4/SPEC.md)
- [2.5](../spec-nova3D-story-2-5/SPEC.md)

## Scope

- Use one Usage-owned checked integer/rational calculator and immutable request/options/rate snapshots.
- Reserve against Account period, $5 parent research-Job lifetime across all attempts, and $1 external-operation ceilings in one transaction.

## Acceptance Criteria

### AC-1

**Given** concurrent operations near any ceiling
**When** maximum costs are reserved
**Then** settled usage plus all outstanding reservations cannot exceed any limit; duplicate admission returns its original receipt

### AC-2

**Given** pinned billing increments and rational rates
**When** the calculator evaluates bounded requests
**Then** it rounds upward once per operation to microdollars and rejects overflow, unknown/foreign rates and unsupported parameters

### AC-3

**Given** an unavailable bound or insufficient allowance
**When** admission is attempted
**Then** no external side effect occurs and the user sees the exact cost block

## Engineering Gates

G-6.

These are acceptance obligations, not claims that the implementation or qualification has passed.
