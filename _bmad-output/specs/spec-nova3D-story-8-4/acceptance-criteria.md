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

## Scope

- Run the dedicated backup service every 12 hours: stream an encrypted logical dump to the backup store without persisting it on Railway, then run an incremental deletion-mirroring Storage sync that records the dump's cutoff; abort without hiding anything on a failed listing or a sharp object-count drop; scope credentials to one bucket per environment.
- Keep the restricted deletion ledger in a separate append-only store outside every restore set; it also carries Account disables, invitation consumption and rotation, recovery revocations and the highest authorization epoch. No backup runs during a restore; after any restore all session grants and Auth sessions are revoked and the ledger replays before access opens. Drill restores into a dedicated restore project and alarm when the newest completed snapshot is older than 18 hours.

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

## Engineering Gates

G-9.

These are acceptance obligations, not claims that the implementation or qualification has passed.
