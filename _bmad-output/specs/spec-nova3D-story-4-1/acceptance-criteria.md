# Acceptance Criteria

**Story 4.1: Publish immutable artifact manifests**

**Epic 4: Generate and inspect traceable canonical geometry.** Approved evidence recipes produce immutable models whose features remain linked to evidence and inspectable without changing manufacturing authority.

As an Account owner,
I want to rely on usable and restorable model files,
So that partial output cannot masquerade as a completed version.

**Requirement IDs:** AR-2, AR-3, AR-5, AR-19, NFR-1, NFR-3, NFR-5, NFR-7

## Dependencies

- [2.2](../spec-nova3D-story-2-2/SPEC.md)
- [2.7](../spec-nova3D-story-2-7/SPEC.md)

## Scope

- Implement the Artifacts-owned manifest family and coordinated verified publication; mutable staging leases are separate.

## Acceptance Criteria

### AC-1

**Given** staged worker bytes and a producing activity
**When** publication commits
**Then** verified digest/length, ownership, kind, serialization version and child references form one canonical JSON manifest root

### AC-2

**Given** a partial upload, changed bytes or revoked attempt
**When** attachment is attempted
**Then** no usable/restorable artifact is published and cleanup respects active leases

### AC-3

**Given** approval, gateway, restoration or deletion consumers
**When** they resolve artifact identity
**Then** all use the same immutable manifest roots rather than independently interpreting object keys

## Engineering Gates

This story has no separate gate ID; applicable project-wide gates still govern acceptance.

These are acceptance obligations, not claims that the implementation or qualification has passed.
