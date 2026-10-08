# Acceptance Criteria

**Story 1.3: Create invitation-only accounts**

**Epic 1: Enter and use a private workspace.** Invited users can authenticate and use a responsive private workspace; Josh can control and recover access without inspecting private content.

As an invited user,
I want to register with a valid invitation,
So that my account starts in its own private workspace.

**Requirement IDs:** FR-1, FR-2, AR-18, NFR-1, NFR-2, UX-DR22

## Dependencies

- [1.1](../spec-nova3D-story-1-1/SPEC.md)
- [1.2](../spec-nova3D-story-1-2/SPEC.md)
- [1.10](../spec-nova3D-story-1-10/SPEC.md)

## Scope

- Implement narrow idempotent registration: a user signs in with Google, then redeems an invitation code to activate an Account. No code, no Account. Invitations are issued and revoked through the audited seed command until Story 1.11 adds the Administrator surface.
- Named and current general codes are hashed, single-use and nonexpiring until used or revoked; partial Auth provisioning is unusable.
- Provision the Administrator (the address in `ADMINISTRATOR_EMAIL`, heimannshua@gmail.com in staging and production; its Google subject is pinned at first sign-in) and the second address in `AUTH_ALLOWED_EMAILS` once through a documented, audited seed that calls the same provisioning function as registration, rather than code redemption. Registration calls the Projects module's exported provisioning command to create the Workspace in the same transaction.
- Registration runs only in a server route using the service role: no registration or invitation database object is executable by `anon` or `authenticated`, attempts are limited to 5 failures per network origin per 15 minutes and 100 failures per hour across all origins, and codes carry at least 128 bits of entropy. Failures are counted in an Identity-owned Postgres table keyed by a keyed hash of the platform-reported client address and the time window, so the limiter works before Redis exists and fails closed. Registration locks the Auth identity row and persists its attempt time, which the dormant-identity purge of Story 1.9 shares. A Before User Created hook declared in `supabase/config.toml` rejects any non-Google or unverified-email creation, and the interim email allowlist stays in force until Story 1.4 replaces it.

## Acceptance Criteria

### AC-1

**Given** one unused invitation and concurrent registrations
**When** both attempt redemption
**Then** at most one activated Account/Workspace is created; retries return the original outcome, the same command ID with a different payload is rejected, partial provisioning cannot sign in, and a signed-in Google identity with no activated Account reaches no private path of the routes that exist (Story 1.4 extends the check to every path); the registration screen works on phone and desktop

### AC-2

**Given** named codes and the current general code
**When** a code is revoked or successfully redeemed
**Then** only successful general-code redemption retires that code, whose replacement the Administrator mints on demand in Story 1.11; unused codes do not time-expire and existing Accounts remain valid

### AC-3

**Given** invalid, used, revoked or guessed codes
**When** registration is attempted repeatedly
**Then** generic failures and rate limits (keyed on network origin plus a global budget, including direct calls to the database API) prevent guessing, code values are not logged, and an unreachable database fails registration closed and the limiter keeps no raw address

### AC-4

**Given** an email, phone, anonymous or unverified-email sign-up attempt
**When** the Auth user would be created
**Then** the Before User Created hook rejects it, and only a verified Google identity can create an Auth user

### AC-5

**Given** a registration holding the Auth identity row lock
**When** a second transaction tries to delete that identity (standing in for the Story 1.9 purge)
**Then** the delete waits or sees the registration attempt and deletes nothing, and the attempt time is persisted

### AC-6

**Given** issued codes
**When** their generation and storage are inspected
**Then** each code has at least 128 bits of entropy, only its hash is stored, and no code appears in logs or responses after issuance

### AC-7

**Given** the audited seed
**When** it runs twice
**Then** the Administrator and the second allowlisted identity each have one activated Account, the Administrator's Google subject is pinned at first sign-in, and a later sign-in with the same email but another subject is refused

### AC-8

**Given** the anon and authenticated database roles
**When** they try to execute a registration, invitation or recovery function or read those tables
**Then** every attempt is denied

## Engineering Gates

This story has no separate gate ID; applicable project-wide gates still govern acceptance.

These are acceptance obligations, not claims that the implementation or qualification has passed.
