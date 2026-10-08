# Acceptance Criteria

**Story 2.7: Accept and execute durable fenced jobs**

**Epic 2: Confirm requests and control background spending.** Users can submit text or ordered pictures, authorize the exact work and costs, and follow durable jobs without losing approved state.

As an Account owner,
I want to continue using Projects while work runs,
So that accepted work survives navigation and failures stay controlled.

**Requirement IDs:** FR-6, AR-3, AR-14, AR-15, AR-26, NFR-4, NFR-5, NFR-8, NFR-10, UX-DR19, UX-DR39, UX-DR40, FR-4

## Dependencies

- [1.5](../spec-nova3D-story-1-5/SPEC.md)
- [2.6](../spec-nova3D-story-2-6/SPEC.md)
- [2.11](../spec-nova3D-story-2-11/SPEC.md)
- [1.9](../spec-nova3D-story-1-9/SPEC.md)
- [1.12](../spec-nova3D-story-1-12/SPEC.md)
- [1.13](../spec-nova3D-story-1-13/SPEC.md)

## Scope

- Commit the Job, its initial reservation and the dispatch outbox together, using the identities of Story 2.11.
- Use signed environment-bound bounded steps (under the Story 1.12 signing-key contract), compatible worker registration and cancellation fencing; never automatically retry failed work. Use a 120-second worker lease renewed every 30 seconds. The committing request publishes the dispatch at once and a QStash schedule sweeps unpublished outbox rows older than 15 seconds every minute, as the Spine fixes. Run the deterministic test-workload step as a Vercel step that a test worker registered through the signed worker-registration endpoint can also take, so lease loss is testable. Workers read inputs and write staged outputs only through the Story 1.12 gateway with attempt-scoped tickets, and report completion with fenced signed commands. The test workload registers a test event type with Story 2.10. Register the outbox-age and expired-lease conditions with the Story 1.13 alarm channel.
- Ship a deterministic test-workload step so durable-job behavior is testable before research exists.
- A user cancel revokes commit authority first and starts no new external step; a completing Job settles actual usage against its reservation and releases only demonstrably unused allowance.

## Acceptance Criteria

### AC-1

**Given** an accepted Job followed by browser close or dispatcher restart
**When** dispatch resumes
**Then** committed outbox and unique receipts retain waiting/running/completed/failed/cancelled state without duplicate side effects; job state is readable on phone and desktop

### AC-2

**Given** a failed test-workload step, worker lease loss or a duplicate transport delivery
**When** the configured workflow and queue are exercised
**Then** failed work stays terminal until explicit user retry; duplicates return receipts and interrupted failure preserves approved state with cause/cost/next action

### AC-3

**Given** a signed callback with stale revision, revoked epoch, expired lease, invalid signature or wrong environment
**When** publication is attempted
**Then** it is rejected; valid requests bind nonce/digest/attempt with ≤5-minute expiry and ≤60-second skew; a missing compatible pinned worker leaves work waiting; a request signed with a revoked or non-active key is rejected, and a retiring key is accepted only for its outstanding window

### AC-4

**Given** an authorized running Job
**When** the user cancels it
**Then** no new external step starts, the Job reaches cancelled with approved state preserved, and only demonstrably unused allowance is released

### AC-5

**Given** a Job whose operations complete
**When** completion is committed
**Then** actual usage settles against the reservation and any unused remainder is released without rewriting history

### AC-6

**Given** an Account disabled while Jobs run
**When** the disable commits
**Then** running Jobs lose commit authority at once, no new external step starts, cancellation signals follow, reservations are held until settled and an audit event records the cancellation

### AC-7

**Given** an unpublished outbox row older than 15 seconds
**When** the sweep runs
**Then** it is published exactly once, an already published row is skipped, and an outbox age over 60 seconds raises the Story 1.13 alarm

## Engineering Gates

This story has no separate gate ID; applicable project-wide gates still govern acceptance.

These are acceptance obligations, not claims that the implementation or qualification has passed.
