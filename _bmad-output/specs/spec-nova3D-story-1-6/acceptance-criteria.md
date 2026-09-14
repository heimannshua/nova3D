# Acceptance Criteria

**Story 1.6: Recover the sole Administrator securely**

**Epic 1: Enter and use a private workspace.** Invited users can authenticate and use a responsive private workspace; Josh can control and recover access without inspecting private content.

As an Administrator,
I want to recover Administrator access,
So that I can regain control without bypassing workspace privacy.

**Requirement IDs:** FR-3, AR-18, NFR-1, NFR-2, UX-DR23, UX-DR72

## Dependencies

- [1.4](../spec-nova3D-story-1-4/SPEC.md)
- [1.5](../spec-nova3D-story-1-5/SPEC.md)

## Scope

- Use a short-lived single-use verified-email recovery link and fresh authentication for sensitive actions.

## Acceptance Criteria

### AC-1

**Given** the configured sole Administrator
**When** recovery is requested
**Then** only the verified email receives the protected link and the response does not expose other Workspaces

### AC-2

**Given** an expired, used or replayed link
**When** redemption is attempted
**Then** access is denied without partial recovery

### AC-3

**Given** a valid recovery link
**When** redemption succeeds
**Then** all prior Administrator sessions are revoked and an immutable recovery audit event is recorded

## Engineering Gates

This story has no separate gate ID; applicable project-wide gates still govern acceptance.

These are acceptance obligations, not claims that the implementation or qualification has passed.
