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
- Sign in uses Google OAuth through Supabase; only the Google provider is enabled while sign-ups stay on, and the live-Account check is the gate. Fresh authentication for sensitive actions is a server-controlled step-up: a Postgres nonce bound to the initiating browser and the OAuth state, `prompt=select_account` without `login_hint`, and acceptance only of a new session whose `amr` shows an `oauth` entry after the nonce start for the same verified email and Google subject. It writes a 5-minute marker (Postgres, never a JWT claim or Redis) for that new session only, revokes the initiating session's grant and records an action class; Account deletion and close-instance markers are consumed by use. It proves a deliberate new sign-in, not a Google credential re-check.
- Replace the interim `AUTH_ALLOWED_EMAILS` gate with the live-Account check in the same change, and remove the variable from the proxy, callback, health route, environment checks and docs.
- Delete Auth identities that have no Account, claim or registration attempt 30 days after their last sign-in or registration attempt, in one transaction that shares registration's row lock; Account foreign keys to the Auth identity restrict deletion.

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

**Given** a failed Google sign-in, a Google identity with no activated Account, or an Administrator session
**When** sign-in or private browsing is attempted
**Then** generic failure states are usable and the Administrator cannot impersonate, browse another Workspace or grant administrators

### AC-4

**Given** a sensitive action and a step-up started from a stolen session
**When** the step-up is completed in another browser, or a different Google account signs in during it
**Then** the initiating session does not become fresh, the marker belongs only to the newly minted session, a mismatch revokes only that new session without a global sign-out, and an expired or replaced nonce is rejected

### AC-5

**Given** an Auth identity with no Account older than 30 days and a registration in flight for another identity
**When** the dormant-identity purge runs
**Then** only the dormant identity is deleted and no in-flight or activated Account, Workspace or claim is removed or orphaned

## Engineering Gates

This story has no separate gate ID; applicable project-wide gates still govern acceptance.

These are acceptance obligations, not claims that the implementation or qualification has passed.
