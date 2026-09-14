# Acceptance Criteria

**Story 8.3: Purge private records and enforce backup expiry**

**Epic 8: Delete private work and prove release readiness.** Users can remove their data, Josh can close the instance, and the complete product is accepted only with real application/device and recovery evidence.

As an Account owner,
I want to have deletion remove controlled copies,
So that retained data does not outlive the adopted limits.

**Requirement IDs:** FR-30, AR-20, AR-21, NFR-12

## Dependencies

- [8.2](../spec-nova3D-story-8-2/SPEC.md)

## Scope

- Purge database, files, models, exports, staging, notifications, private usage/adoption associations and operational traces under the deletion manifest.

## Acceptance Criteria

### AC-1

**Given** a committed deletion
**When** active cleanup runs
**Then** all controlled active private copies purge within 24 hours; immutable audit/billing records are not exempt from deletion

### AC-2

**Given** private backups and subsequent restore/rebackup
**When** retention is applied
**Then** controlled copies expire within 30 days measured from deletion, never extended by restoration or rebackup

### AC-3

**Given** retained shared research, aggregates and deletion exclusions
**When** retention is audited
**Then** only allowed public-source data, nonidentifying aggregates and the minimum restricted opaque-target anti-resurrection ledger remain; external/disconnected-copy limitations are disclosed accurately

## Engineering Gates

G-9.

These are acceptance obligations, not claims that the implementation or qualification has passed.
