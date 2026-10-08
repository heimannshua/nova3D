# Acceptance Criteria

**Story 2.11: Create durable Job, attempt, step and operation identities**

**Epic 2: Confirm requests and control background spending.** Users can submit text or ordered pictures, authorize the exact work and costs, and follow durable jobs without losing approved state.

As an Account owner,
I want to have every unit of background work recorded under a unique identity,
So that retries and charges can never be duplicated or lost.

**Requirement IDs:** FR-6, AR-3, AR-14, NFR-4, NFR-5

## Dependencies

- [1.5](../spec-nova3D-story-1-5/SPEC.md)
- [1.7](../spec-nova3D-story-1-7/SPEC.md)
- [1.8](../spec-nova3D-story-1-8/SPEC.md)

## Scope

- Create the Jobs-owned Job, JobAttempt, StepExecution and ExternalOperation record families with their uniqueness rules (attempt per Job, step per attempt and key, operation per step and ordinal) and immutable operation receipts.
- A user retry creates a new attempt under the same Job and waits until the prior potentially chargeable operation is terminal or reconciled. Public states are waiting, running, completed, failed and cancelled, with stage and reason. Dispatch, signing and workers are Story 2.7; reservations are Story 2.6.
- A "potentially chargeable" operation is one whose dispatch was persisted and whose outcome is not yet terminal or classified noncharge; "reconciled" means a settlement or noncharge classification is recorded (Story 2.8 supplies the process, this story stores the state). Commands carry a command ID: the same ID with a different payload is rejected.

## Acceptance Criteria

### AC-1

**Given** the same logical step requested twice
**When** two commands create it
**Then** one StepExecution and one ExternalOperation exist and the second command returns the original receipt; the same command ID with a different payload is rejected

### AC-2

**Given** a failed attempt with a potentially chargeable operation
**When** the user requests a retry
**Then** a new attempt under the same Job waits until the prior operation is terminal or reconciled, and no attempt-number change bypasses that wait

### AC-3

**Given** any Job
**When** its state is shown
**Then** the public state, stage and reason agree with the records and a terminal failed or cancelled attempt can never be reclaimed

## Engineering Gates

This story has no separate gate ID; applicable project-wide gates still govern acceptance.

These are acceptance obligations, not claims that the implementation or qualification has passed.
