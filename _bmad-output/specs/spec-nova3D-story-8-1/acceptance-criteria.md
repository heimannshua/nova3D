# Acceptance Criteria

**Story 8.1: Tombstone Project and Export deletion before cleanup**

**Epic 8: Delete private work and prove release readiness.** Users can remove their data, Josh can close the instance, and the complete product is accepted only with real application/device and recovery evidence.

As an Account owner,
I want to delete selected Projects or Exports,
So that private content becomes inaccessible immediately.

**Requirement IDs:** FR-30, AR-15, AR-21, NFR-1, NFR-5, NFR-12, UX-DR19, UX-DR30

## Dependencies

- [6.9](../spec-nova3D-story-6-9/SPEC.md)
- [7.5](../spec-nova3D-story-7-5/SPEC.md)
- [1.8](../spec-nova3D-story-1-8/SPEC.md)

## Scope

- Implement fresh-authenticated explicit deletion intent and manifests across record owners, using the tombstone contract of Story 1.8, before best-effort cancellation/purge.
- Project and Export deletion each need a fresh-authentication marker of the owner-deletion class (valid 5 minutes).

## Acceptance Criteria

### AC-1

**Given** an owned Project or Export and fresh authentication
**When** explicit deletion confirmation commits
**Then** the target is hidden/tombstoned before cleanup and all dependent private paths reject access; the confirmation works on phone and desktop

### AC-2

**Given** late Jobs, callbacks, uploads, imports or cache promotion
**When** they race deletion
**Then** revoked commit authority and tombstones prevent mutation or resurrection even after retries

### AC-3

**Given** interrupted multi-store cleanup
**When** deletion resumes
**Then** the durable manifest remains retryable and distinguishes immediately inaccessible from cleanup complete

### AC-4

**Given** an Account owner deleting a Project or Export
**When** the explicit deletion confirmation is submitted
**Then** it needs a fresh-authentication marker of the owner-deletion class and is refused with the step-up offered when none exists; a marker of another action class is refused

### AC-5

**Given** a Project or Export deletion
**When** it commits
**Then** an audit event records the actor and an opaque target identity only, with no identifiable deleted-user history

## Engineering Gates

G-9.

These are acceptance obligations, not claims that the implementation or qualification has passed.
