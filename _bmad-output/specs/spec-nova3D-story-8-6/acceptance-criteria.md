# Acceptance Criteria

**Story 8.6: Qualify offline execution and authoritative sync**

**Epic 8: Delete private work and prove release readiness.** Users can remove their data, Josh can close the instance, and the complete product is accepted only with real application/device and recovery evidence.

As an Account owner,
I want to rely on offline creation across supported devices,
So that storage and inference evidence covers real failures and reconnects.

**Requirement IDs:** AR-22, AR-23, AR-27, NFR-4, NFR-5, NFR-10, SC-2, SC-3, UX-DR13, UX-DR14

## Dependencies

- [7.6](../spec-nova3D-story-7-6/SPEC.md)
- [8.5](../spec-nova3D-story-8-5/SPEC.md)

## Scope

- Run the G-8 held-out multi-view, offline asset, local persistence, eviction/interruption and conflict/revocation matrix on real devices.

## Acceptance Criteria

### AC-1

**Given** a prepared supported device disconnected from all network services
**When** held-out conversion and reopen tests run
**Then** the real reconstruction model satisfies the 500 MiB/1 GiB/120-second limits with honest quality/coverage and retained original bytes

### AC-2

**Given** eviction, interruption, duplicate import, newer server work, disable or deletion
**When** the device reconnects
**Then** recorded failures preserve allowed work and prove idempotency, conflict retention, monotonic locking and purge-before-import

### AC-3

**Given** a missing compliant engine or unrun required device case
**When** release readiness is evaluated
**Then** G-8 stays BLOCKED and full first-version release remains blocked without dropping phone/multi-view/offline scope

## Engineering Gates

G-8.

These are acceptance obligations, not claims that the implementation or qualification has passed.
