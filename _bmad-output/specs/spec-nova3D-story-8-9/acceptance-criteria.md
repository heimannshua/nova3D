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

## Scope

- Build `workers/backup` on Railway, run every 12 hours: stream an age-encrypted logical dump (application schemas plus Auth and Storage metadata) straight to the private Backblaze bucket without persisting it on Railway, then run an incremental, deletion-mirroring Storage sync that records the dump's cutoff, and write a dated manifest of counts and digests. Credentials are scoped to one bucket per environment in Backblaze's US East region, and the service holds only the public encryption key.
- Abort the sync without hiding or deleting anything when a listing page fails or the object count falls sharply against Postgres metadata. Apply the lifecycle (dumps removed after 14 days, deleted-at-source objects after 7 days, object lock of at most 7 days). The Administrator holds the private key in a password manager; losing it makes dumps unreadable, which the application discloses.
- Supply the Backblaze adapter for the restore ledger of Story 1.8: a separate bucket, a create-only application key and no lifecycle rule. A scheduled route on the application platform, independent of the backup service, raises the Story 1.9 alarm when the newest completed snapshot is older than 18 hours.

## Acceptance Criteria

### AC-1

**Given** a staging project with database rows and Storage objects
**When** a scheduled backup run executes
**Then** an encrypted dump and a deletion-mirroring Storage copy reach the bucket, nothing is persisted on Railway, the manifest records cutoff, counts and digests, and the service cannot decrypt what it wrote

### AC-2

**Given** a failed listing page or an object count that drops sharply against Postgres
**When** the Storage sync runs
**Then** it aborts, hides and deletes nothing, and raises an alarm

### AC-3

**Given** the real bucket
**When** lifecycle and object lock are exercised
**Then** dumps expire within 14 days and deleted-at-source objects within 7 days, and locks last no longer than 7 days

### AC-4

**Given** the backup service stopped or failing
**When** 18 hours pass without a completed snapshot
**Then** the independent monitor emails the Administrator and shows the alarm, once per condition per 24 hours

### AC-5

**Given** a restore-ledger event
**When** the adapter writes it
**Then** the key can create but never overwrite or delete ledger objects, and a dump decrypts only with the private key the Administrator supplies

## Engineering Gates

G-9.

These are acceptance obligations, not claims that the implementation or qualification has passed.
