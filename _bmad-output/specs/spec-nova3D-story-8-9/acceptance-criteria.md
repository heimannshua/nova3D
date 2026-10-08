# Acceptance Criteria

**Story 8.9: Back up the database and Storage independently**

**Epic 8: Delete private work and prove release readiness.** Users can remove their data, Josh can close the instance, and the complete product is accepted only with real application/device and recovery evidence.

As an Administrator,
I want to have encrypted backups of the database and every stored file made on their own every 12 hours,
So that a lost provider or a bad change cannot take my users' work.

**Requirement IDs:** AR-21, AR-26, NFR-7, NFR-12

## Dependencies

- [1.8](../spec-nova3D-story-1-8/SPEC.md)
- [1.9](../spec-nova3D-story-1-9/SPEC.md)
- [1.10](../spec-nova3D-story-1-10/SPEC.md)
- [4.1](../spec-nova3D-story-4-1/SPEC.md)
- [1.13](../spec-nova3D-story-1-13/SPEC.md)

## Scope

- Build `workers/backup` on Railway, run every 12 hours: stream an age-encrypted logical dump (application schemas plus Auth and Storage metadata) straight to the private Backblaze bucket without persisting it on Railway, then run an incremental, deletion-mirroring Storage sync in which every mirrored object is individually age-encrypted under the same public key and keyed by its manifest-root digest (source digests are compared with the backup manifest, never with ciphertext), and write a dated manifest of counts and digests that records the dump's cutoff. A run is complete only when its manifest is written. The service checks the destination key prefix against its `instance_identity`, uses a database role that can only read, holds only the public encryption key and bucket-scoped credentials in Backblaze's US East region, and reaches only the database and the object store.
- Abort the sync without hiding or deleting anything when a listing page fails, the object count falls more than 10% against the previous run, or it differs from Postgres metadata by more than 1%; a failed or aborted run reports through a signed failure callback to an application route, which creates the Story 1.13 alarm. Apply the lifecycle (dumps removed after 14 days, deleted-at-source objects after 7 days, object lock of at most 7 days). The Administrator holds the private key in a password manager, and the Administrator page states that losing it makes the dumps unreadable.
- Supply the Backblaze adapter for the restore ledger of Story 1.8: a separate bucket, an application key without delete capabilities, unique hash-chained keys and no lifecycle rule; the reader treats a duplicated, hidden or missing link as tampering and alarms. A scheduled application route, independent of the backup service and run every 30 minutes, reads the newest manifest with a read-only key and registers the snapshot-age condition (older than 18 hours) with the Story 1.13 alarm channel.

## Acceptance Criteria

### AC-1

**Given** a staging project with database rows and Storage objects
**When** a scheduled backup run executes
**Then** an encrypted dump and individually encrypted mirrored objects reach the bucket, nothing is persisted on Railway, the destination prefix matches the instance identity, the manifest records cutoff, counts and digests, and the service cannot decrypt what it wrote

### AC-2

**Given** a failed listing page, an object count that falls more than 10% against the previous run, or a difference above 1% from Postgres metadata
**When** the Storage sync runs
**Then** it aborts, hides and deletes nothing, and the failure callback creates an alarm

### AC-3

**Given** the bucket configuration and an injected clock
**When** lifecycle and object-lock settings are inspected and the clock advances
**Then** dumps expire within 14 days, deleted-at-source objects within 7 days, and locks last no longer than 7 days

### AC-4

**Given** the backup service stopped or failing
**When** 18 hours pass without a completed manifest
**Then** the independent monitor emails the Administrator and shows the alarm, once per condition per 24 hours

### AC-5

**Given** restore-ledger events written by the adapter
**When** the key and the reader are exercised
**Then** the key cannot delete objects, entries have unique chained keys, a duplicated, hidden or missing link is flagged as tampering, and a dump decrypts only with the private key the Administrator supplies

### AC-6

**Given** the Administrator page
**When** backup status is shown
**Then** it states that losing the private key makes the dumps unreadable

## Engineering Gates

G-9.

These are acceptance obligations, not claims that the implementation or qualification has passed.
