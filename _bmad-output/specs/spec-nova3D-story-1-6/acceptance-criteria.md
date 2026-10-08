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

- Recovery serves a lost or failed Google sign-in for the sole Administrator. A no-input server route mints a single-use token (only its hash stored in Postgres, one outstanding, issuance rate-limited globally), and the application emails its own link to the configured Administrator address through Resend using the `resend.dev` sender, because no domain is owned and the Resend account must be registered with that address. The link is the only non-Google sign-in path and exists only for the sole Administrator.
- The application enforces the 15-minute lifetime on its own clock. Redemption needs a POST confirmation, then mints the session through the Auth Admin API, revokes all prior Administrator sessions and writes a fresh-authentication marker for that session only. Staging must confirm the Admin link API and `verifyOtp` work with the Email provider disabled; if not, keep the provider on and restrict creation to the Administrator address in the Before User Created hook.

## Acceptance Criteria

### AC-1

**Given** the configured sole Administrator
**When** recovery is requested
**Then** only the verified email receives the protected link and the response does not expose other Workspaces

### AC-2

**Given** an expired, used or replayed link
**When** redemption is attempted, including a mail scanner's GET request
**Then** access is denied without partial recovery

### AC-3

**Given** a valid recovery link
**When** redemption succeeds
**Then** all prior Administrator sessions are revoked, the new session holds a fresh-authentication marker and an immutable recovery audit event is recorded

## Engineering Gates

This story has no separate gate ID; applicable project-wide gates still govern acceptance.

These are acceptance obligations, not claims that the implementation or qualification has passed.
