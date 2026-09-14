# Acceptance Criteria

**Story 7.2: Prepare a verified offline bundle**

**Epic 7: Create direct models offline and synchronize safely.** Prepared supported devices can create honestly labeled image-derived models offline, preserve them locally and synchronize without privacy or history loss.

As an Account owner,
I want to prepare my device while online,
So that conversion assets are available when disconnected.

**Requirement IDs:** AR-22, AR-23, SC-2, UX-DR13, UX-DR14, UX-DR31, UX-DR38

## Dependencies

- [7.1](../spec-nova3D-story-7-1/SPEC.md)

## Scope

- Cache verified public app/model assets with Account-scoped IndexedDB metadata and OPFS private artifacts.

## Acceptance Criteria

### AC-1

**Given** an online supported device and pinned bundle
**When** preparation completes
**Then** all required app/runtime/model bytes are verified and readiness records exact versions and storage state

### AC-2

**Given** interrupted preparation, eviction, insufficient storage or missing bytes
**When** offline conversion is requested
**Then** actionable missing-preparation/storage states prevent an unverified run and never silently upload images

### AC-3

**Given** offline preparation guidance
**When** the user prepares
**Then** online preparation/qualified export and revocation-on-reconnect are explained, including no disconnected time lease and limits on remote erasure

## Engineering Gates

G-8.

These are acceptance obligations, not claims that the implementation or qualification has passed.
