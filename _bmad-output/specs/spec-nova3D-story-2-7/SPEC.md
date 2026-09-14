---
id: SPEC-nova3D-story-2-7
status: final
companions:
- acceptance-criteria.md
- implementation-constraints.md
- ../spec-nova3D/SPEC.md
sources:
- ../../planning-artifacts/story-inputs/story-2-7.json
---

# Story 2.7: Accept and execute durable fenced jobs

## Why

An Account owner needs to continue using Projects while work runs. Accepted work survives navigation and failures stay controlled.

## Capabilities

- **CAP-1**
  - **intent:** Retain accepted work across navigation and dispatcher failures.
  - **success:** Given an accepted Job followed by browser close or dispatcher restart, when dispatch resumes, then committed outbox and unique receipts retain waiting/running/completed/failed/cancelled state without duplicate side effects.

- **CAP-2**
  - **intent:** Keep failed work terminal until an explicit permitted retry.
  - **success:** Given failed research, worker lease loss or a duplicate transport delivery, when the configured workflow and queue are exercised, then failed work stays terminal until explicit user retry; duplicates return receipts and interrupted failure preserves approved state with cause/cost/next action.

- **CAP-3**
  - **intent:** Reject results without current publication authority.
  - **success:** Given a signed callback with stale revision, revoked epoch, expired lease, invalid signature or wrong environment, when publication is attempted, then it is rejected; valid requests bind nonce/digest/attempt with ≤5-minute expiry and ≤60-second skew; a missing compatible pinned worker leaves work waiting.

All [acceptance criteria](acceptance-criteria.md) apply to the complete story.

## Constraints

- This story implements the declared slice after its listed dependencies; it does not absorb unrelated parent capabilities.
- The [implementation constraints](implementation-constraints.md) and recursively adopted parent contract are mandatory, including ratified overrides to older source wording.
- Existing product decisions remain binding. Spec completion does not establish implementation, device support or engineering-gate acceptance.

## Non-goals

- Implementing unassigned later-story behavior or creating all future domain entities in advance.
- Adding manual mesh editing, public registration, printer control or commercial storefront behavior.

## Success signal

Committed outbox and unique receipts retain waiting/running/completed/failed/cancelled state without duplicate side effects. The exact criteria demonstrate the complete story outcome and its failure boundaries; any gate-status change requires actual qualification evidence.

## Assumptions

- Story boundaries and ordering are delegated fast-path planning choices; they do not claim separate user approval. Detailed shared assumptions remain in the constraints companion.
