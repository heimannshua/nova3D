# Acceptance Criteria

**Story 2.7: Accept and execute durable fenced jobs**

**Epic 2: Confirm requests and control background spending.** Users can submit text or ordered pictures, authorize the exact work and costs, and follow durable jobs without losing approved state.

As an Account owner,
I want to continue using Projects while work runs,
So that accepted work survives navigation and failures stay controlled.

**Requirement IDs:** FR-6, AR-3, AR-14, AR-15, AR-26, NFR-4, NFR-5, NFR-8, NFR-10, UX-DR19, UX-DR39, UX-DR40

## Dependencies

- [1.5](../spec-nova3D-story-1-5/SPEC.md)
- [2.6](../spec-nova3D-story-2-6/SPEC.md)

## Scope

- Commit Job, attempt/step/operation identities, initial reservation and dispatch outbox together.
- Use signed environment-bound bounded steps, compatible worker registration and cancellation fencing; never automatically retry failed work.

## Acceptance Criteria

### AC-1

**Given** an accepted Job followed by browser close or dispatcher restart
**When** dispatch resumes
**Then** committed outbox and unique receipts retain waiting/running/completed/failed/cancelled state without duplicate side effects

### AC-2

**Given** failed research, worker lease loss or a duplicate transport delivery
**When** the configured workflow and queue are exercised
**Then** failed work stays terminal until explicit user retry; duplicates return receipts and interrupted failure preserves approved state with cause/cost/next action

### AC-3

**Given** a signed callback with stale revision, revoked epoch, expired lease, invalid signature or wrong environment
**When** publication is attempted
**Then** it is rejected; valid requests bind nonce/digest/attempt with ≤5-minute expiry and ≤60-second skew; a missing compatible pinned worker leaves work waiting

## Engineering Gates

This story has no separate gate ID; applicable project-wide gates still govern acceptance.

These are acceptance obligations, not claims that the implementation or qualification has passed.
