# Acceptance Criteria

**Story 1.9: Provision staging and run periodic jobs**

**Epic 1: Enter and use a private workspace.** Invited users can authenticate and use a responsive private workspace; Josh can control and recover access without inspecting private content.

As an Administrator,
I want to have a staging environment and reliable scheduled jobs,
So that housekeeping and recovery do not depend on someone remembering them.

**Requirement IDs:** AR-26, NFR-2, NFR-4, AR-18

## Dependencies

- [1.4](../spec-nova3D-story-1-4/SPEC.md)
- [1.6](../spec-nova3D-story-1-6/SPEC.md)
- [1.8](../spec-nova3D-story-1-8/SPEC.md)
- [1.10](../spec-nova3D-story-1-10/SPEC.md)

## Scope

- Treat the existing hosted Supabase project as staging (Story 1.1 relabels it, Story 1.10 records its plan and region), push the `supabase/config.toml` auth settings with the CLI and make CI diff them against the live settings. Provision Upstash Redis and QStash in us-east-1 and the Railway project, and deploy the staging application as its own Vercel project whose production branch is `staging`, so QStash has a signed staging endpoint to call; Vercel previews stay synthetic.
- Run periodic work from QStash schedules that invoke idempotent routes verified with the provider-native signature check and the stored instance identity; every run writes an immutable receipt. Intervals: orphan cleanup and purge-deadline checks hourly, ledger relay retry every 5 minutes, dormant-identity purge daily. The first task is the dormant-identity purge: delete Auth identities that have no Account, claim or registration attempt 30 days after their last sign-in or registration attempt, in one transaction that locks the identity row as registration does (Story 1.3), with Account foreign keys to the Auth identity restricting deletion.
- Raise the operational alarm channel: a task with no receipt within twice its interval, or a ledger event pending beyond its retry window, creates a Lifecycle alarm record shown on the Administrator page and emailed to the Administrator address through the application mailer of Story 1.6, once per condition per 24 hours. Production projects are created in Story 8.7 and receive no real private data before Story 8.4 passes its drill.

## Acceptance Criteria

### AC-1

**Given** the staging project and the committed `supabase/config.toml`
**When** CI compares them with the live settings
**Then** drift in enabled providers, the sign-up setting, redirect URLs or OTP expiry fails the check

### AC-2

**Given** a scheduled task
**When** its schedule fires twice, or arrives with an invalid signature or the wrong environment
**Then** only one run executes, foreign or invalid calls are rejected and every run writes an immutable receipt

### AC-3

**Given** an Auth identity with no Account older than 30 days and a registration for that same identity arriving as the purge runs
**When** both transactions run concurrently
**Then** exactly one outcome occurs under the shared row lock: the purge deletes first and the registration finds no identity and asks the user to sign in again, or the registration commits first and the purge deletes nothing; no Account or Workspace is ever orphaned

### AC-4

**Given** a task that has not run within twice its interval
**When** monitoring evaluates
**Then** an alarm names the task and its last receipt, appears on the Administrator page and is emailed once per condition per 24 hours

### AC-5

**Given** an Auth identity with no Account older than 30 days and a registration in flight for a different identity
**When** the dormant-identity purge runs
**Then** only the dormant identity is deleted and no in-flight or activated Account, Workspace or claim is removed or orphaned

## Engineering Gates

This story has no separate gate ID; applicable project-wide gates still govern acceptance.

These are acceptance obligations, not claims that the implementation or qualification has passed.
