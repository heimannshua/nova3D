# Acceptance Criteria

**Story 1.3: Create invitation-only accounts**

**Epic 1: Enter and use a private workspace.** Invited users can authenticate and use a responsive private workspace; Josh can control and recover access without inspecting private content.

As an invited user,
I want to register with a valid invitation,
So that my account starts in its own private workspace.

**Requirement IDs:** FR-1, FR-2, AR-18, NFR-1, NFR-2, UX-DR22, UX-DR69

## Dependencies

- [1.1](../spec-nova3D-story-1-1/SPEC.md)
- [1.2](../spec-nova3D-story-1-2/SPEC.md)

## Scope

- Implement fresh-authenticated Administrator invitation issuance/revocation and narrow idempotent registration: a user signs in with Google, then redeems an invitation code to activate an Account. No code, no Account.
- Named and current general codes are hashed, single-use and nonexpiring until used or revoked; partial Auth provisioning is unusable.
- Provision the Administrator (heimannshua@gmail.com, Google subject pinned at first sign-in) and the other currently allowlisted identity once through a documented, audited seed that calls the same provisioning function as registration, rather than code redemption.
- Registration runs only in a server route using the service role: no registration or invitation database object is executable by `anon` or `authenticated`, attempts are limited to 5 failures per network origin per 15 minutes and 100 failures per hour across all origins, and codes carry at least 128 bits of entropy.

## Acceptance Criteria

### AC-1

**Given** one unused invitation and concurrent registrations
**When** both attempt redemption
**Then** at most one activated Account/Workspace is created; retries return the original outcome, partial provisioning cannot sign in, and a signed-in Google identity with no activated Account reaches no private path

### AC-2

**Given** named codes and the current general code
**When** a code is revoked or successfully redeemed
**Then** only successful general-code redemption rotates that code; unused codes do not time-expire and existing Accounts remain valid

### AC-3

**Given** invalid, used, revoked or guessed codes
**When** registration is attempted repeatedly
**Then** generic failures and rate limits (keyed on network origin plus a global budget, including direct calls to the database API) prevent guessing, code values are not logged, and fresh-authenticated administration records an audit event

## Engineering Gates

This story has no separate gate ID; applicable project-wide gates still govern acceptance.

These are acceptance obligations, not claims that the implementation or qualification has passed.
