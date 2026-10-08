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
- Reject any cookie-authenticated mutation that lacks a valid origin and CSRF check before it changes state.
- Authorization fails closed: when Postgres or the live-authorization lookup is unreachable, private requests are denied with a retryable state and no cached grant is honored. Create the Account-owned Preferences record and migrate the device-local choices of Story 1.2 on first sign-in.
- Create the Identity-owned session-grant record: every sign-in, including step-up and recovery sessions, issues one grant tied to its Auth session_id; each private request verifies it; and revocation by session, by Account and by epoch is a single primitive that Stories 1.5 and 1.6 reuse.
- Sessions last at most 30 days and expire after 7 days of inactivity (declared in `supabase/config.toml`), and Settings offers "sign out my other sessions", which revokes their grants.
- Push `supabase/config.toml` and the migrations to staging by hand with the Supabase CLI, following `docs/staging.md`, until the CI of Story 1.9 does it.

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
**Then** generic failure states are usable and the Administrator cannot impersonate, browse another Workspace or grant administrators; a disabled Account sees the disabled state without private data, and sign-in and its failure states work on phone and desktop

### AC-4

**Given** a sensitive action and a step-up started from a stolen session
**When** the step-up is completed in another browser, or a different Google account signs in during it
**Then** the initiating session does not become fresh, the marker belongs only to the newly minted session, a mismatch revokes only that new session without a global sign-out, and an expired or replaced nonce is rejected

### AC-5

**Given** a cookie-authenticated mutation from a foreign origin or without its CSRF token
**When** it is submitted
**Then** it is rejected before any state change, while the same request from the application's own origin succeeds

### AC-6

**Given** Postgres or the live-authorization lookup is unreachable
**When** a private request arrives
**Then** it is denied with a retryable state, no cached JWT or grant is honored, and durable pending work is preserved

### AC-7

**Given** preferences chosen on a device before sign-in
**When** an Account first signs in
**Then** they become the Account's stored preferences and follow it across devices

### AC-8

**Given** a completed sign-in
**When** the callback finishes and the user later signs out
**Then** one grant exists for the session_id, sign-out revokes it, and a request on the revoked session is refused

### AC-9

**Given** the staging deployment with only the Google provider enabled
**When** a step-up completes
**Then** a new session_id whose `amr` holds an `oauth` entry at or after the nonce start is accepted, the marker (action class, 5-minute expiry) belongs to that session only, and the initiating session's grant is revoked

### AC-10

**Given** a session older than the 30-day time-box or idle for more than 7 days
**When** a private request arrives
**Then** it is refused and the user must sign in again

### AC-11

**Given** a user with several signed-in sessions
**When** they choose "sign out my other sessions" in Settings
**Then** every other session's grant is revoked at once, the current session continues, and the action works on phone and desktop

## Engineering Gates

This story has no separate gate ID; applicable project-wide gates still govern acceptance.

These are acceptance obligations, not claims that the implementation or qualification has passed.
