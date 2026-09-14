# Acceptance Criteria

**Story 5.2: Regenerate only the affected dependency closure**

**Epic 5: Correct, compare and approve exact model versions.** Users can request evidence corrections, regenerate only affected geometry, restore history and approve the exact model they inspected.

As an Account owner,
I want to apply an approved correction,
So that unrelated geometry stays within the agreed tolerance.

**Requirement IDs:** FR-21, AR-8, AR-9, AR-10, AR-15, NFR-3, NFR-5, NFR-6

## Dependencies

- [5.1](../spec-nova3D-story-5-1/SPEC.md)
- [4.3](../spec-nova3D-story-4-3/SPEC.md)

## Scope

- Rebuild the complete dependency closure from the newly approved plan into a successor immutable Model Version.

## Acceptance Criteria

### AC-1

**Given** an approved corrected plan
**When** regeneration executes
**Then** every dependent feature is rebuilt and records the new activity, recipe and evidence bindings

### AC-2

**Given** unrelated canonical features
**When** old and new versions are compared
**Then** correspondence and geometry remain within the ratified R-2 tolerance under the same pinned frame

### AC-3

**Given** stale, cancelled or superseded correction work
**When** publication is attempted
**Then** fencing rejects it and prior versions remain available; failed generation waits for explicit retry

## Engineering Gates

This story has no separate gate ID; applicable project-wide gates still govern acceptance.

These are acceptance obligations, not claims that the implementation or qualification has passed.
