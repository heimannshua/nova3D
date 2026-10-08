# Acceptance Criteria

**Story 2.12: Retain confirmed pictures as immutable Project artifacts**

**Epic 2: Confirm requests and control background spending.** Users can submit text or ordered pictures, authorize the exact work and costs, and follow durable jobs without losing approved state.

As an Account owner,
I want to have my confirmed pictures kept with the request that used them,
So that later research, conversion and recovery use the exact pictures I confirmed.

**Requirement IDs:** AR-3, AR-19, NFR-1, NFR-3, NFR-7, SC-1

## Dependencies

- [2.2](../spec-nova3D-story-2-2/SPEC.md)
- [2.3](../spec-nova3D-story-2-3/SPEC.md)

## Scope

- On confirmation of a request, attach its ordered staged pictures to the immutable request revision as Project-owned artifacts: create the Artifacts-owned manifest record family and the coordinated verified publication command (canonical JSON manifest root, ownership scope, digest and length), then let the staging copies expire.
- Later consumers (subject identification, research, direct conversion and reconversion) read these retained roots, never lease-bounded staging. Story 4.1 extends the same family to worker outputs.

## Acceptance Criteria

### AC-1

**Given** a confirmed request and its staged pictures
**When** retention runs
**Then** each picture has a verified manifest root, the request revision references the ordered roots and the staging copies expire

### AC-2

**Given** changed bytes, a foreign owner or an expired lease before attachment
**When** retention is attempted
**Then** nothing is published and the request stays unconfirmed with an actionable state

### AC-3

**Given** a later consumer needing the pictures
**When** it resolves them
**Then** it reads the retained roots and the original digests match the confirmed order

## Engineering Gates

This story has no separate gate ID; applicable project-wide gates still govern acceptance.

These are acceptance obligations, not claims that the implementation or qualification has passed.
