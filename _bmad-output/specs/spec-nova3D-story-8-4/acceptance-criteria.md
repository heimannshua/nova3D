# Acceptance Criteria

**Story 8.4: Restore the service without resurrecting deleted data**

**Epic 8: Delete private work and prove release readiness.** Users can remove their data, Josh can close the instance, and the complete product is accepted only with real application/device and recovery evidence.

As an Account owner,
I want to recover surviving work after a failure,
So that backups restore geometry and enforce every intervening deletion.

**Requirement IDs:** FR-22, FR-30, AR-21, AR-26, NFR-7, NFR-12

## Dependencies

- [8.3](../spec-nova3D-story-8-3/SPEC.md)

## Scope

- Back up database daily and objects independently; keep the restricted deletion ledger outside rollback and drill actual provisioned restore paths.

## Acceptance Criteria

### AC-1

**Given** a database backup, independent artifact backups and deletions after backup
**When** a restore drill runs
**Then** the external deletion ledger replays before access opens and every surviving manifest/artifact is verified

### AC-2

**Given** a cross-store crash or a missing/corrupt surviving object
**When** recovery executes
**Then** deleted data remains excluded and incomplete restoration is reported rather than exposed as successful

### AC-3

**Given** the provisioned recovery setup
**When** a measured drill completes
**Then** RPO and RTO are each ≤24 hours and active-purge/backup-expiry settings and provider plans are evidenced

## Engineering Gates

G-9.

These are acceptance obligations, not claims that the implementation or qualification has passed.
