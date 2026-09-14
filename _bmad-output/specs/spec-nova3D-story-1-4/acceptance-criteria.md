# Acceptance Criteria

**Story 1.4: Authenticate with live workspace isolation**

**Epic 1: Enter and use a private workspace.** Invited users can authenticate and use a responsive private workspace; Josh can control and recover access without inspecting private content.

As an Account owner,
I want to access only my workspace,
So that my projects and files stay private.

**Requirement IDs:** FR-2, AR-3, AR-18, NFR-1, NFR-2, UX-DR21

## Dependencies

- [1.3](../spec-nova3D-story-1-3/SPEC.md)

## Scope

- Enforce JWT plus live Account and session grant on every currently implemented private API and direct database/storage path.
- Carry ownership-scoped IDs, foreign keys and denial behavior into every subsequent module.

## Acceptance Criteria

### AC-1

**Given** two Accounts and private records
**When** one tries the other Account through APIs, direct RLS paths and storage identifiers
**Then** reads and writes disclose no private content and cannot create cross-Workspace references

### AC-2

**Given** a valid JWT with a revoked grant or inactive Account
**When** a private request arrives
**Then** live authorization rejects it even if the browser bypasses the UI

### AC-3

**Given** invalid credentials or an Administrator session
**When** sign-in or private browsing is attempted
**Then** generic failure states are usable and the Administrator cannot impersonate, browse another Workspace or grant administrators

## Engineering Gates

This story has no separate gate ID; applicable project-wide gates still govern acceptance.

These are acceptance obligations, not claims that the implementation or qualification has passed.
