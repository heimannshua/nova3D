# Acceptance Criteria

**Story 2.10: Record actionable in-app notifications**

**Epic 2: Confirm requests and control background spending.** Users can submit text or ordered pictures, authorize the exact work and costs, and follow durable jobs without losing approved state.

As an Account owner,
I want to open the exact item needing attention,
So that background progress remains usable across sessions.

**Requirement IDs:** FR-7, AR-25, SC-5, UX-DR18, UX-DR25, UX-DR39, UX-DR40

## Dependencies

- [2.7](../spec-nova3D-story-2-7/SPEC.md)

## Scope

- Commit durable per-recipient event history and authorized deep links; realtime delivery is a hint.

## Acceptance Criteria

### AC-1

**Given** research readiness, generation success/failure or export readiness
**When** the event is committed
**Then** one durable notification per recipient/event appears in the app-wide bar and history

### AC-2

**Given** duplicate, missing or delayed realtime delivery
**When** the client refreshes
**Then** canonical history reconciles without losing or duplicating events

### AC-3

**Given** an unread/read notification or deleted/foreign target
**When** it is selected
**Then** the exact live-authorized item opens or an unavailable state appears; Prints in Progress remains Coming later

## Engineering Gates

This story has no separate gate ID; applicable project-wide gates still govern acceptance.

These are acceptance obligations, not claims that the implementation or qualification has passed.
