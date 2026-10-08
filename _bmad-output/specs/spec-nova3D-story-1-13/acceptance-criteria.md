# Acceptance Criteria

**Story 1.13: Raise operational alarms**

**Epic 1: Enter and use a private workspace.** Invited users can authenticate and use a responsive private workspace; Josh can control and recover access without inspecting private content.

As an Administrator,
I want to be told when something stops working,
So that failures and silent stalls do not go unnoticed.

**Requirement IDs:** AR-26, NFR-4, UX-DR72

## Dependencies

- [1.6](../spec-nova3D-story-1-6/SPEC.md)
- [1.8](../spec-nova3D-story-1-8/SPEC.md)
- [1.9](../spec-nova3D-story-1-9/SPEC.md)
- [1.12](../spec-nova3D-story-1-12/SPEC.md)

## Scope

- Create the Lifecycle-owned alarm record family and an Administrator operations page (phone and desktop) listing open alarms with condition, first and latest time and last receipt. Each alarm is emailed to the Administrator address through the application mailer of Story 1.6 once per condition per 24 hours.
- Register the conditions this story can observe: a periodic task with no receipt within twice its interval, a ledger event pending over 15 minutes, and more than 25 Auth identities without an Account. Later stories register the others from the Spine's threshold list when their data exists: outbox age and expired leases (Story 2.7), unknown-cost operations (Story 2.8), storage integrity (Story 4.1), missed purge deadlines (Story 8.3) and backup snapshot age (Story 8.9).
- Watch the schedulers against each other: a small Railway cron task, which holds only its own Ed25519 signing key, posts a signed heartbeat to the application every 30 minutes and asks a signed application route for the latest QStash receipt time. The application raises the alarm and sends the email in either direction when the other scheduler's latest receipt is more than two hours old.

## Acceptance Criteria

### AC-1

**Given** a condition that crosses its threshold
**When** the monitor evaluates
**Then** one alarm record is created, shown on the operations page on phone and desktop and emailed once per condition per 24 hours, and clearing the condition marks it resolved without deleting history

### AC-2

**Given** a periodic task that stops, or a ledger event left pending
**When** twice its interval or 15 minutes passes
**Then** the matching alarm names the task or event and its last receipt

### AC-3

**Given** either scheduler stopped
**When** its peer finds the other's latest receipt more than two hours old
**Then** the surviving scheduler raises an alarm

### AC-4

**Given** a condition registered by a later story with its threshold (a fixture condition here)
**When** the monitor evaluates
**Then** the same alarm path handles it with no new channel

### AC-5

**Given** the mailer failing when an alarm is raised
**When** the alarm is recorded
**Then** the alarm record and operations page still show it, and the email is retried at the next evaluation

## Engineering Gates

This story has no separate gate ID; applicable project-wide gates still govern acceptance.

These are acceptance obligations, not claims that the implementation or qualification has passed.
