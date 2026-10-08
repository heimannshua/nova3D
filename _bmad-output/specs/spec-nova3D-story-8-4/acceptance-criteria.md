# Acceptance Criteria

**Story 8.4: Restore the service without resurrecting deleted data**

**Epic 8: Delete private work and prove release readiness.** Users can remove their data, Josh can close the instance, and the complete product is accepted only with real application/device and recovery evidence.

As an Account owner,
I want to recover surviving work after a failure,
So that backups restore geometry and enforce every intervening deletion.

**Requirement IDs:** FR-22, FR-30, AR-21, AR-26, NFR-7, NFR-12

## Dependencies

- [8.3](../spec-nova3D-story-8-3/SPEC.md)
- [1.9](../spec-nova3D-story-1-9/SPEC.md)
- [8.9](../spec-nova3D-story-8-9/SPEC.md)

## Scope

- Drill restores from the Story 8.9 backups into a dedicated restore project: restore the dump, copy the Storage objects, verify every referenced artifact and treat a manifest without bytes as unusable.
- Replay the restricted ledger of Story 1.8, held outside every restore set, before access opens: tombstones, Account disables, invitation consumption and rotation, recovery revocations and the highest authorization epoch. No backup runs during a restore; after any restore all session grants and Auth sessions are revoked, and a scrub removes ledgered targets from live and hidden backup copies.

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
**Then** RPO (the age of the newest completed snapshot) and RTO are each ≤24 hours and active-purge/backup-expiry settings and provider plans are evidenced

### AC-4

**Given** a snapshot taken before an Account disable, an invitation consumption, a general-code rotation and a recovery revocation
**When** it is restored
**Then** the ledger replay re-applies each (the Account stays disabled, consumed and rotated codes stay unusable, recovery links stay revoked, the authorization epoch is at least the ledger maximum) and all session grants and Auth sessions are revoked before access opens

### AC-5

**Given** a restore in progress
**When** a scheduled backup would start and the restore completes
**Then** no backup runs during the restore, and afterwards the scrub removes ledgered targets from live and hidden backup copies

## Engineering Gates

G-9.

These are acceptance obligations, not claims that the implementation or qualification has passed.
