# Acceptance Criteria

**Story 1.5: Disable and re-enable account access**

**Epic 1: Enter and use a private workspace.** Invited users can authenticate and use a responsive private workspace; Josh can control and recover access without inspecting private content.

As an Administrator,
I want to disable an invited Account,
So that I can revoke access without deleting its work.

**Requirement IDs:** FR-3, AR-15, AR-18, NFR-1, NFR-2, UX-DR70, UX-DR72

## Dependencies

- [1.4](../spec-nova3D-story-1-4/SPEC.md)

## Scope

- Implement fresh-authenticated account-status transitions, revocable session grants and authorization epochs.
- Expose a cancellation/fencing contract that every future Job and file path must use.

## Acceptance Criteria

### AC-1

**Given** an enabled invited Account with live sessions
**When** a freshly authenticated Administrator disables it
**Then** session/download authority and commit epochs revoke atomically before cancellation signals, while its Workspace is retained

### AC-2

**Given** a revoked epoch and a late registered operation
**When** the operation attempts publication or another external step
**Then** the authority guard denies it and audit evidence records the transition without private contents

### AC-3

**Given** a disabled Account
**When** the Administrator re-enables it
**Then** new authentication can regain access under a newer epoch; previously revoked sessions remain revoked

## Engineering Gates

This story has no separate gate ID; applicable project-wide gates still govern acceptance.

These are acceptance obligations, not claims that the implementation or qualification has passed.
