# Acceptance Criteria

**Story 1.8: Define tombstones and the hidden-state contract**

**Epic 1: Enter and use a private workspace.** Invited users can authenticate and use a responsive private workspace; Josh can control and recover access without inspecting private content.

As an Account owner,
I want to have deleted or disabled private targets stop being reachable at once,
So that later features cannot bypass deletion or revocation.

**Requirement IDs:** FR-30, AR-15, AR-21, NFR-1, NFR-12

## Dependencies

- [1.5](../spec-nova3D-story-1-5/SPEC.md)
- [1.6](../spec-nova3D-story-1-6/SPEC.md)

## Scope

- Create the Lifecycle-owned tombstone record family, monotonic target revisions and the hide-before-revoke ordering that every module read, write, import, callback and cache-promotion path must honor; deleted Project and Account IDs are never reusable.
- Expose the tombstone check as a reusable authority guard beside the Story 1.5 epoch guard. Deletion commands, manifests and cleanup are supplied by Stories 8.1 to 8.3.
- Record the auditable deletion-verification procedure required by PRD D-3 before any purge code ships: which stores are checked (database, Storage, backups, notifications, logs), how absence is proven, and who runs it.
- Create the Lifecycle-owned restore ledger port and its outbox relay for tombstones, Account disables and re-enables, invitation consumption and rotation, recovery revocations and the highest authorization epoch. Stories 1.3, 1.5 and 1.6 append their events through it from this story on. The local change always takes effect first; the relay retries until the ledger store accepts the event and exposes how many are pending for monitoring. Story 8.9 supplies the Backblaze adapter; until then the relay writes to a fixture store.

## Acceptance Criteria

### AC-1

**Given** a target marked tombstoned
**When** any read, write, import, callback or cache-promotion path touches it
**Then** the guard rejects it before any other effect and returns an unavailable state without disclosing contents

### AC-2

**Given** a stale status reply carrying an older revision
**When** it is compared with a recorded tombstone or disable
**Then** the higher monotonic revision wins and a tombstone is never downgraded

### AC-3

**Given** a deleted Project or Account ID
**When** a new record is created
**Then** the ID cannot be reused and only its opaque identity is retained for anti-resurrection

### AC-4

**Given** deletion work about to begin
**When** the verification procedure is reviewed
**Then** an auditable procedure naming each store, the proof of absence and its runner is recorded before purge code ships

### AC-5

**Given** an Account disable, an invitation consumption or a recovery revocation
**When** it commits
**Then** a ledger event is queued with the change and relayed idempotently, and a ledger store outage leaves the change in force with the event pending and counted

## Engineering Gates

G-9.

These are acceptance obligations, not claims that the implementation or qualification has passed.
