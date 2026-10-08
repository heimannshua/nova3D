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
- Replay the restricted ledger of Story 1.8, held outside every restore set, before access opens: tombstones, Account disables, invitation consumption and rotation, recovery revocations and the highest authorization epoch. The restore state is a lock object in the ledger bucket, which a database restore cannot roll back; no backup runs while it is set, and access reopens only after the replay writes its completion event. The restore tooling writes the lock and the completion event with a separate operator key; the application and the backup service read the lock with a read-only key, and the application refuses every private request while the lock is set. After any restore all session grants and Auth sessions are revoked, and a scrub removes ledgered targets from live copies and deletes their mirrored objects, while remaining dumps expire within 14 days.
- Each drill creates a dedicated Supabase restore project and deletes it afterwards. It verifies the replay with its own read-only ledger key and the private age key that the Administrator supplies for that drill.
- A restore also mints a new instance UUID (so every queued message and worker registration from before it is rejected), fails every non-terminal Job as interrupted by the restore, clears outbox rows older than the snapshot and keeps paid adapters disabled until the Administrator has reconciled provider usage and re-enables them. The application caches the restore lock for 30 seconds and, if the store is unreachable, keeps the last value for at most 10 minutes and then refuses private requests.

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
**Then** no backup runs during the restore, and afterwards the scrub removes ledgered targets from live copies and deletes their mirrored objects while remaining dumps expire within 14 days; the application refuses every private request while the lock is set

### AC-6

**Given** a restore and a later rebackup
**When** retention is applied
**Then** controlled copies still expire within 30 days measured from deletion

### AC-7

**Given** a snapshot taken while a Job was waiting and a charge was ambiguous
**When** it is restored
**Then** the new instance UUID rejects queued messages from before, the Job is failed as interrupted, paid adapters stay disabled, and nothing is dispatched or charged until the Administrator re-enables them

## Engineering Gates

G-9.

These are acceptance obligations, not claims that the implementation or qualification has passed.
