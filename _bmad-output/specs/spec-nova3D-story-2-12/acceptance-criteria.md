# Acceptance Criteria

**Story 2.12: Retain confirmed pictures as immutable Project artifacts**

**Epic 2: Confirm requests and control background spending.** Users can submit text or ordered pictures, authorize the exact work and costs, and follow durable jobs without losing approved state.

As an Account owner,
I want to have my confirmed pictures kept with the request that used them,
So that later research, conversion and recovery use the exact pictures I confirmed.

**Requirement IDs:** AR-3, AR-19, NFR-1, NFR-3, NFR-7, SC-1, AR-2, AR-5

## Dependencies

- [2.2](../spec-nova3D-story-2-2/SPEC.md)
- [2.3](../spec-nova3D-story-2-3/SPEC.md)

## Scope

- When the user confirms the ordered pictures (the end of the Story 2.3 quality review), attach them to the Project as retained artifacts and pin their roots in a successor request revision: create the Artifacts-owned manifest record family and the coordinated verified publication command (canonical JSON manifest root, ownership scope, digest and length), strip location tags from the retained copy and record its digest, then let the staging copies expire. A retained-picture quota of 2 GiB per Account applies, and a breach rejects the whole confirmation rather than part of it. The metadata strip runs inside the attach step of the Story 1.12 gateway; the retained digest is recorded together with the original staged digest it replaces, so acknowledgments pinned to originals stay verifiable; a repeated confirmation returns the same roots; and staging copies expire when the retained roots commit or at their lease end, whichever comes first.
- Later consumers (subject identification, research, direct conversion and reconversion) read these retained roots, never lease-bounded staging. Story 4.1 extends the same family to worker outputs.

## Acceptance Criteria

### AC-1

**Given** confirmed ordered pictures and their staged copies
**When** retention runs
**Then** each picture has a verified manifest root, a successor request revision pins the ordered roots and the staging copies expire

### AC-2

**Given** changed bytes, a foreign owner or an expired lease before attachment
**When** retention is attempted
**Then** nothing is published and the pictures stay unconfirmed with an actionable state; the states are readable on phone and desktop

### AC-3

**Given** a later consumer needing the pictures
**When** it resolves them
**Then** it reads the retained roots, and each retained digest maps to the original staged digest the user confirmed, in the confirmed order

### AC-4

**Given** the retained-picture quota is exceeded or an image carries location tags
**When** retention runs
**Then** the quota rejects the excess with an actionable state, and the retained copy has no location tags while its digest and the confirmed order are recorded

### AC-5

**Given** a confirmation submitted twice
**When** retention runs both times
**Then** the second run returns the same roots and creates no duplicate artifacts

## Engineering Gates

This story has no separate gate ID; applicable project-wide gates still govern acceptance.

These are acceptance obligations, not claims that the implementation or qualification has passed.
