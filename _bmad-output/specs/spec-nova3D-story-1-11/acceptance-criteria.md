# Acceptance Criteria

**Story 1.11: Manage invitations with fresh authentication**

**Epic 1: Enter and use a private workspace.** Invited users can authenticate and use a responsive private workspace; Josh can control and recover access without inspecting private content.

As an Administrator,
I want to issue and revoke named and general invitation codes,
So that only the people I choose can register.

**Requirement IDs:** FR-1, AR-18, NFR-1, NFR-2, UX-DR69, UX-DR72

## Dependencies

- [1.3](../spec-nova3D-story-1-3/SPEC.md)
- [1.4](../spec-nova3D-story-1-4/SPEC.md)

## Scope

- Add the Administrator invitation page (AD-01): create named single-use codes, show the current general code, and revoke any unused code. A code's value is shown once, at creation, and afterwards only its identifier and status are listed.
- Issuance and revocation require the fresh-authentication marker of Story 1.4 (action class administration), call the same issuance function the audited seed uses and append an immutable audit event holding the actor, action and code identifier but never the code value.

## Acceptance Criteria

### AC-1

**Given** an Administrator session without a fresh-authentication marker
**When** issuance or revocation is attempted
**Then** it is refused and the step-up is offered; with a valid 5-minute marker it succeeds

### AC-2

**Given** a created code
**When** it is displayed and later listed
**Then** the value is shown once, only its identifier and status are listed afterwards, and logs never contain it

### AC-3

**Given** issue, revoke and failed attempts
**When** the audit trail is reviewed
**Then** each has an immutable event with actor and time and no code value, and the page works on phone and desktop

## Engineering Gates

This story has no separate gate ID; applicable project-wide gates still govern acceptance.

These are acceptance obligations, not claims that the implementation or qualification has passed.
