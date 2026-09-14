# Acceptance Criteria

**Story 4.4: Apply clearly user-added personalization**

**Epic 4: Generate and inspect traceable canonical geometry.** Approved evidence recipes produce immutable models whose features remain linked to evidence and inspectable without changing manufacturing authority.

As an Account owner,
I want to add personal details in ordinary language,
So that my additions remain distinct from historical reconstruction.

**Requirement IDs:** FR-17, AR-5, AR-8, NFR-3, UX-DR7, UX-DR46, UX-DR50

## Dependencies

- [4.2](../spec-nova3D-story-4-2/SPEC.md)
- [4.3](../spec-nova3D-story-4-3/SPEC.md)

## Scope

- Generate a personalized altar/ramp variation through the trusted recipe with explicit user-added feature provenance.

## Acceptance Criteria

### AC-1

**Given** an approved reconstruction and confirmed personal addition
**When** personalization generates
**Then** the addition is a new versioned user-added feature with separate parameters and provenance

### AC-2

**Given** an unsupported or ambiguous addition
**When** the generator evaluates it
**Then** clarification or an actionable unsupported result occurs without inventing a historical source

### AC-3

**Given** changed visible personalization
**When** the candidate is inspected
**Then** prior exact-model approval and validation cannot authorize the changed candidate; unchanged recipe features satisfy the comparator

## Engineering Gates

This story has no separate gate ID; applicable project-wide gates still govern acceptance.

These are acceptance obligations, not claims that the implementation or qualification has passed.
