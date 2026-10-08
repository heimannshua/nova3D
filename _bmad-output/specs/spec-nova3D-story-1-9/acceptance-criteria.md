# Acceptance Criteria

**Story 1.9: Provision staging and run periodic jobs**

**Epic 1: Enter and use a private workspace.** Invited users can authenticate and use a responsive private workspace; Josh can control and recover access without inspecting private content.

As an Administrator,
I want to have a staging environment and reliable scheduled jobs,
So that housekeeping and recovery do not depend on someone remembering them.

**Requirement IDs:** AR-26, NFR-2, NFR-4

## Dependencies

- [1.4](../spec-nova3D-story-1-4/SPEC.md)

## Scope

- Create the staging Supabase project, push the `supabase/config.toml` auth settings with the CLI and make CI diff them against the live settings; provision Upstash Redis and QStash in us-east-1 and a Railway project, recording the actual plans and regions.
- Run periodic work from a QStash schedule that invokes an idempotent route verified with the provider-native signature check and the stored environment identity; every run writes an immutable receipt. The first task is the dormant-identity purge: delete Auth identities that have no Account, claim or registration attempt 30 days after their last sign-in or registration attempt, in one transaction that shares registration's row lock, with Account foreign keys to the Auth identity restricting deletion.
- Alarm when a task has not run within its interval. Production projects are created in Story 8.7 and receive no real private data before Story 8.4 passes its drill.

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

**Given** an Auth identity with no Account older than 30 days and a registration in flight for another identity
**When** the dormant-identity purge runs
**Then** only the dormant identity is deleted and no in-flight or activated Account, Workspace or claim is removed or orphaned

### AC-4

**Given** a task that has not run within its interval
**When** monitoring evaluates
**Then** an alarm names the task and its last receipt

## Engineering Gates

This story has no separate gate ID; applicable project-wide gates still govern acceptance.

These are acceptance obligations, not claims that the implementation or qualification has passed.
