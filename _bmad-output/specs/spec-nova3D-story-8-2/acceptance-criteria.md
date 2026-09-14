# Acceptance Criteria

**Story 8.2: Delete an Account or close the instance**

**Epic 8: Delete private work and prove release readiness.** Users can remove their data, Josh can close the instance, and the complete product is accepted only with real application/device and recovery evidence.

As an Account owner or sole Administrator within the applicable authority,
I want to remove my Workspace or close the service,
So that all authorized private targets enter the deletion process.

**Requirement IDs:** FR-30, AR-18, AR-21, NFR-1, NFR-12, UX-DR19, UX-DR68, UX-DR73

## Dependencies

- [8.1](../spec-nova3D-story-8-1/SPEC.md)
- [1.6](../spec-nova3D-story-1-6/SPEC.md)

## Scope

- Implement Account deletion, sole-Administrator safeguards and the separate global close-instance flow without private browsing.

## Acceptance Criteria

### AC-1

**Given** a normal Account with fresh authentication
**When** whole-Account deletion is explicitly confirmed
**Then** sessions revoke and all owned private targets, jobs and pending work enter the durable deletion manifest

### AC-2

**Given** the sole Administrator while invitees remain
**When** ordinary self-deletion is requested
**Then** it is blocked with the close-instance consequence explained rather than leaving orphaned administration

### AC-3

**Given** a freshly authenticated Administrator
**When** close-instance destructive confirmation succeeds
**Then** all Accounts/Workspaces are tombstoned, invitations/secrets and jobs revoke globally, and cleanup proceeds without exposing private contents

## Engineering Gates

G-9.

These are acceptance obligations, not claims that the implementation or qualification has passed.
