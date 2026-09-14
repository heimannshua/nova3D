# Acceptance Criteria

**Story 3.7: Show actual research activity and bounded escalation**

**Epic 3: Research and approve a complete evidence plan.** Users can inspect authoritative evidence, control source eligibility, resolve interpretations and approve one complete reconstruction plan.

As an Account owner,
I want to follow sources being examined and approve needed paid work,
So that background research stays understandable and controlled.

**Requirement IDs:** FR-6, FR-7, FR-14, AR-14, AR-15, AR-17, AR-25, NFR-8, NFR-9, NFR-10, UX-DR11, UX-DR39, UX-DR40, UX-DR41

## Dependencies

- [3.1](../spec-nova3D-story-3-1/SPEC.md)
- [3.5](../spec-nova3D-story-3-5/SPEC.md)
- [3.6](../spec-nova3D-story-3-6/SPEC.md)
- [2.8](../spec-nova3D-story-2-8/SPEC.md)
- [2.10](../spec-nova3D-story-2-10/SPEC.md)

## Scope

- Render recorded searching/opened/lead/accepted/rejected/replacement events and permitted escalation.

## Acceptance Criteria

### AC-1

**Given** a running research Job
**When** sources are examined or replaced
**Then** actual activity and evidence-based explanations appear without fabricated hidden reasoning

### AC-2

**Given** free research leaves a material gap
**When** paid escalation is proposed
**Then** it explains the gap and requires matching disclosure/permission and a bounded reservation before a paid operation

### AC-3

**Given** failure, cancellation, policy change or stale inputs
**When** a step finishes
**Then** fencing preserves approved state, actionable cost/failure status is visible, and retries wait for the user and any charge reconciliation

## Engineering Gates

This story has no separate gate ID; applicable project-wide gates still govern acceptance.

These are acceptance obligations, not claims that the implementation or qualification has passed.
