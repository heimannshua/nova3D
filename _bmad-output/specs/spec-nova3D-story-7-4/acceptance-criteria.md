# Acceptance Criteria

**Story 7.4: Synchronize offline drafts without overwriting history**

**Epic 7: Create direct models offline and synchronize safely.** Prepared supported devices can create honestly labeled image-derived models offline, preserve them locally and synchronize without privacy or history loss.

As an Account owner,
I want to find local work in My Projects after reconnecting,
So that sync does not duplicate or discard versions.

**Requirement IDs:** AR-3, AR-5, AR-22, NFR-1, NFR-5, NFR-7, SC-2, UX-DR14, UX-DR28

## Dependencies

- [7.3](../spec-nova3D-story-7-3/SPEC.md)
- [1.4](../spec-nova3D-story-1-4/SPEC.md)

## Scope

- Import stable UUIDs only into the original authorized Account with verified artifacts and expected parent revision.

## Acceptance Criteria

### AC-1

**Given** an authorized reconnect and a local draft
**When** sync is delivered more than once
**Then** one idempotent import appears in original My Projects using verified digests and stable identities

### AC-2

**Given** a newer server version or divergent local history
**When** import checks revisions
**Then** both versions are retained for explicit conflict selection rather than silently overwriting either

### AC-3

**Given** network/authentication uncertainty or a failed import
**When** sync stops
**Then** pending/failed/conflict state is visible and local work is not erased or attached to another Account

## Engineering Gates

G-8.

These are acceptance obligations, not claims that the implementation or qualification has passed.
