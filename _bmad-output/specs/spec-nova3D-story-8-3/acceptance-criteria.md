# Acceptance Criteria

**Story 8.3: Purge private records and enforce backup expiry**

**Epic 8: Delete private work and prove release readiness.** Users can remove their data, Josh can close the instance, and the complete product is accepted only with real application/device and recovery evidence.

As an Account owner,
I want to have deletion remove controlled copies,
So that retained data does not outlive the adopted limits.

**Requirement IDs:** FR-30, AR-20, AR-21, NFR-12

## Dependencies

- [8.2](../spec-nova3D-story-8-2/SPEC.md)
- [8.9](../spec-nova3D-story-8-9/SPEC.md)

## Scope

- Purge database, files, models, exports, staging, notifications, private usage/adoption associations and operational traces under the deletion manifest.
- Apply the Story 8.9 backup lifecycle to deletions: deleted targets leave dumps within 14 days and deleted-at-source objects within 7 days. Run a monthly canary on a synthetic Account with an internal system-actor deletion (the interactive step-up applies to humans only), proving the deletion reaches the database, Storage and backups within 15 days from manifests and bucket listings, since dumps are encrypted. Account purge also deletes the Auth identity. Register the missed-purge-deadline condition with the Story 1.13 alarm channel.

## Acceptance Criteria

### AC-1

**Given** a committed deletion
**When** active cleanup runs
**Then** all controlled active private copies purge within 24 hours; immutable audit/billing records are not exempt from deletion

### AC-2

**Given** private backups of dumps and mirrored objects
**When** retention is applied
**Then** controlled copies expire within 30 days measured from deletion, never extended by a later backup run (restore and rebackup are tested in Story 8.4)

### AC-3

**Given** retained shared research, aggregates and deletion exclusions
**When** retention is audited
**Then** only allowed public-source data, nonidentifying aggregates and the minimum restricted opaque-target anti-resurrection ledger remain; external/disconnected-copy limitations are disclosed accurately

### AC-4

**Given** a synthetic Account and Project in the monthly canary
**When** an internal system-actor deletion runs
**Then** the Project is absent from the database and Storage, its mirrored objects are gone within 7 days, every dump created before the purge has expired within 14 days (judged from manifests and bucket listings, with an injected clock in tests), and a miss raises an alarm

## Engineering Gates

G-9.

These are acceptance obligations, not claims that the implementation or qualification has passed.
