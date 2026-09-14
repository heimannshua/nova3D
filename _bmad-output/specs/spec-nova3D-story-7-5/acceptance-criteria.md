# Acceptance Criteria

**Story 7.5: Enforce learned offline revocation before sync**

**Epic 7: Create direct models offline and synchronize safely.** Prepared supported devices can create honestly labeled image-derived models offline, preserve them locally and synchronize without privacy or history loss.

As an Account owner,
I want to have private local state honor server authority on contact,
So that disabled or deleted work cannot be republished.

**Requirement IDs:** FR-3, FR-30, AR-23, NFR-1, NFR-12, SC-2, UX-DR14

## Dependencies

- [7.4](../spec-nova3D-story-7-4/SPEC.md)
- [1.5](../spec-nova3D-story-1-5/SPEC.md)

## Scope

- Implement permitted_local, locked_disabled and terminal tombstoned states with monotonic server revisions.

## Acceptance Criteria

### AC-1

**Given** a learned Account disable
**When** contact occurs before sync/export
**Then** local work and private stores lock until a newer authoritative re-enable for the original Account

### AC-2

**Given** a learned Account or Project tombstone
**When** authority is checked
**Then** affected private files and pending commands purge before import; deleted IDs cannot be reused

### AC-3

**Given** older status responses, JWT refresh, Account switching, connectivity changes or timeout
**When** local state is reconsidered
**Then** none bypass known disable/deletion; uncertainty alone is not deletion, disconnected permitted drafts have no time lease and explicit sign-out clears private stores

## Engineering Gates

G-8.

These are acceptance obligations, not claims that the implementation or qualification has passed.
