# Deletion verification: how absence is proven, by whom, and where the proof is kept

This is the auditable procedure that PRD decision D-3 requires **before deletion work begins**: "FR-30 private data is removed from operational backups within 30 days; durable deletion tombstones prevent restoration or late Jobs from resurrecting it. The implementation must define an auditable verification procedure before deletion work begins." Story 1.8 records it. Stories 8.1 to 8.3 build the deletion commands, the manifest and the purge, and **no purge code ships until this document has been reviewed and signed off** (see [Review and sign-off](#review-and-sign-off)). Nothing in the application deletes anything today: the tombstone record, its guard, the ledger and the status route exist ([the authority contract](authority-contract.md), "The tombstone guard"), and a tombstone only hides.

It is written for the Administrator (Josh), who runs or signs off every proof below, and for the stories that will implement the parts a system runs. It names every store a private copy can live in, how absence is proven there, who runs the proof and when, and where the evidence is kept. A store that is not in this document is not verified, and a deletion that touches one is not finished.

## What "deleted" means here

The order is fixed (AD-15, AR-21): **tombstone and hide first** (so the target is unreachable at once: `api.record_tombstone` disables an Account under a raised epoch, or marks a Project deleted under a raised revision, and queues the ledger event), **then** revoke access, cancel Jobs and late writes, **then** purge. Every proof below is run after the purge, against the manifest of what the purge was to remove.

| What | Limit | Measured from |
| --- | --- | --- |
| Active private copies (database, Storage, staging, notifications, caches the application controls) | removed promptly, **no more than 24 hours** (R-9) | the tombstone |
| Copies in controlled backups | expire or are removed **within 30 days** (R-9) | the deletion; **never extended** by a restore or a re-backup |
| The anti-resurrection ledger (the tombstones, and the ledger events in the outbox and the ledger store) | keeps **opaque identities only**: a tombstone's target kind and ID, status handle, revision and time, and the opaque change events keyed by Account ID (and by the invitation, pre-authorization or recovery-token row ID): `account_authority` (status and authorization epoch), `invitation_consumed`, `invitation_revoked`, `preauthorization_consumed`, `recovery_redeemed`, and `tombstone` (with the handle). None holds an address, a title, a code or a token, or a hash of one | forever (it is the one permitted remainder) |
| Disconnected devices and copies a person downloaded | outside these guarantees (R-8); a learned tombstone purges a device when it reconnects (Stories 7.4, 7.5) | not proven here |

The only things that may remain after a deletion are the tombstone, its ledger event and the Account's earlier opaque change events in the ledger (see the row above: they name the Account by its opaque ID and nothing else), and what FR-30 permits: source-derived Claims and provenance in the shared research cache that cannot reveal the Account or the Project, and non-identifying aggregate totals of payments.

## The deletion manifest

The proofs compare against a **deletion manifest**, written by the deletion command (Story 8.2) before anything is purged and covering every place the target has data: database records, images, model artifacts, exports, staging, notifications, private usage associations, payment requests, payments and credit entries, local operational traces and backups (AD-15). It holds opaque identifiers, object keys and manifest-root digests and counts, never content, a title, an address or a prompt. A store with no entry in the manifest is a store the manifest forgot, and the proof for it fails (see [When a proof fails](#when-a-proof-fails)).

## The stores

Each store has the same four things: how absence is **proven**, who **runs** the proof, **when**, and where the **evidence** is kept. "The verifier" is the system actor of the deletion verification job (Story 8.3, scheduled by Story 1.9's scheduler); "the Administrator" is Josh, who signs off. Evidence never holds private content: it holds opaque IDs, object keys, digests, counts and times.

### Database

The Supabase Postgres database: every table with a record for the target (Accounts, Workspaces, Projects, Jobs, Versions, Sources, notifications, usage, payment requests, payments, credit entries, preferences, session grants, audit references, the Auth user and its sessions).

The file gateway's `artifacts` tables (Story 1.12) are in this store, each keyed by the Account's ID in `account_id`: `artifacts.staging_leases` (an upload: its content digest, length, content type and state), `artifacts.manifests` (an attached file's immutable manifest: its canonical body, which holds the file's digest, kind, length, the upload's ID and the Account's ID, and its root), `artifacts.transfer_handles` and `artifacts.ticket_redemptions` (the session grant, target and times of each transfer; the redemption record also holds the opaque ID of each command). They hold opaque IDs, digests and counts and no content, but a digest of a file is a fingerprint of it, so they are private data and the manifest lists them. **They are immutable by design**: a lease only moves forward through its states, a redemption, a handle and a manifest are append-only, and a delete or a truncate is refused for every role, the database owner included, so that the record of what was redeemed and attached cannot be rewritten. The deletion command therefore cannot purge them with an ordinary `delete`: purging these tables is a step of Epic 8 that lifts that guard deliberately and under audit. The proof for them is the same as for the rest of this store (a query by the Account's ID returns zero rows), and until that step exists it cannot pass, so a deletion that reaches an Account with uploads is recorded as not finished (see [When a proof fails](#when-a-proof-fails)). The rows of `artifacts.service_key_revocations` hold no Account and are not part of any target.

- **Proof of absence:** for each table and column the manifest lists, a query by the target's ID (and, for an Account, its Workspace ID and Auth user ID) returns **zero rows**; a catalog-driven pass then lists every column in every schema that references the `projects` or `identity` tables by a foreign key and shows none still points at the target. The only rows left are the tombstone (`lifecycle.tombstones`: kind, ID, status handle, revision, time) and the ledger events (`lifecycle.ledger_outbox`), which hold nothing else. For an Account, the Auth user no longer exists (the Auth Admin API answers not found for its ID), and `POST /api/status` with its handle answers `deleted` without any sign-in.
- **Run by:** the verifier, automatically, after the purge; the Administrator reviews the result and signs the deletion off.
- **When:** after every purge completes (within 24 hours of the tombstone); again at the monthly canary below, and after every restore (the ledger is replayed first, Story 8.4).
- **Evidence kept:** a verification record in the Lifecycle deletion record in the database (the manifest's digest, each table checked, the counts found, the time, the verifier's version), and the ledger event of the tombstone. No target content.

### Storage and object stores

Supabase Storage (the private buckets for images, model artifacts and exports) and any staging area the application controls; Railway scratch is disposable and holds no authoritative data (see Logs and operational traces).

The file gateway's bucket, `private-files` (Story 1.12), holds every file a person uploads, under two prefixes that each begin with the Account's ID: `staging/<account>/<upload>` (an upload before it is attached; the hourly cleanup removes the object of an expired or released lease, and the gateway's `delete-staging` command deletes the exact prefix) and `objects/<account>/<root>` (an attached file, under the root of its own manifest; the gateway's `delete-root` command deletes exactly that key). Only the gateway deletes in this bucket, with its own key, on a signed command from the application; no other role can read or list it. Two uploads of the same bytes are two manifests with two roots and two objects, so the deletion manifest must list every root of the Account, and absence for this bucket is proven by a **listing by the Account's prefixes**: a listing of `staging/<account>/` and of `objects/<account>/` in `private-files` returns no object, each key of the manifest (`objects/<account>/<root>` for every root, and every upload still staged) answers not found when asked individually, and `storage.objects` has no row with `bucket_id = 'private-files'` and a name under either prefix. An upload that failed leaves nothing (the partial object is aborted and the lease released), and a refused attach deletes its own copy, so no key under `objects/` exists without a manifest; a key that does is a finding.

- **Proof of absence:** a listing of the bucket by the Account's and the Project's key prefixes returns **no objects**; each object key in the manifest answers not found when asked individually (a listing alone can miss a key); and the Storage metadata table (`storage.objects`) has no row for any manifest key. The object counts before and after are compared with the manifest.
- **Run by:** the verifier, with the service role; the Administrator reviews.
- **When:** after every purge, and at the monthly canary.
- **Evidence kept:** the same verification record: bucket, prefixes, manifest keys checked, listing counts, the time.

### Backups

Three controlled copies exist (AD-15; R-9) and each has its own proof, because each expires on its own clock:

1. Supabase's own daily database backups (Postgres only; Storage objects are not in them).
2. The dedicated backup service's encrypted logical dumps in the Backblaze bucket (every 12 hours; dumps removed within 14 days).
3. The incremental, deletion-mirroring Storage sync in the same bucket (every mirrored object individually age-encrypted and keyed by its manifest-root digest; objects deleted at source removed within 7 days; object lock of at most 7 days).

- **Proof of absence:** **dumps are encrypted, so absence is judged from manifests and bucket listings, never by decrypting a dump in routine operation.** (a) For the mirror: the bucket listing holds no key whose manifest-root digest is in the deletion manifest, from the seventh day after the deletion. (b) For the dumps: every dump with a cutoff before the deletion is gone from the bucket listing by the fourteenth day, so no dump that still holds the target remains; the newest dump's cutoff is after the deletion. (c) For Supabase's backups: the plan's documented retention (recorded from the plan settings at provisioning, [the provisioning guide](provisioning.md)) is shorter than 30 days, and the date of the oldest backup in the console is after the deletion by then. (d) For restores: a restore drill shows the ledger is replayed before access opens and the scrub removes the ledgered targets from the restored copy (Stories 8.4 and 8.5); the age private key held by the Administrator is used only in drills.
- **Run by:** the verifier compares the manifests and listings (read-only key); the Administrator runs the restore drills, because the private key lives with the Administrator in a password manager and nowhere else.
- **When:** at day 7 (mirror), day 15 (dumps and Supabase backups: the **monthly canary** below proves it within 15 days) and day 30 (the legal limit, the last check); a restore drill at least once before launch and after any change to backups.
- **Evidence kept:** the dated listing digests and manifest names compared, outside the repository in the Administrator's evidence folder, and the drill's note; the verification record references them by name.

### Notifications

In-app notification records (database), and anything sent outside the application. Outgoing mail goes only to the Administrator address (recovery links and operational alarms) and carries no private content or Account data beyond an opaque count or condition name; the application sends no email, push or SMS to an invited Account.

- **Proof of absence:** the notification rows for the Account and its Projects are zero (part of the database proof); the mailer's code and tests show nothing private is in any message (`tests/unit/mailer.test.ts`); and the Administrator's mailbox is searched for the target's ID and handle after the deletion and finds none.
- **Run by:** the verifier for the rows; the Administrator for the mailbox search.
- **When:** after every purge for the rows; at the monthly canary for the mailbox.
- **Evidence kept:** the verification record (rows) and the canary note (mailbox search result).

### Logs

Application logs (Vercel functions, Railway services), Supabase logs (API, Auth, Postgres) and the logs of the other providers below. The application is built not to put private content in a log: an error names the call and an HTTP status, never a title, an address, a code, a token, a handle or an ID of private content (pinned by `tests/unit/gate-structure.test.ts`), and the status route logs nothing at all.

- **Proof of absence:** (a) the code check above stays green; (b) search each provider's log retention window for the deleted target's ID, its Workspace ID and its status handle and find **no match**; (c) the retention each provider's current plan documents is recorded, and a log that outlives 30 days is an exception that must be disclosed (see Outside providers) or the log must be shortened.
- **Run by:** the Administrator, in each provider's log console.
- **When:** at the monthly canary, and after any change to what is logged.
- **Evidence kept:** a dated note per provider with the query, the window searched and the result, in the Administrator's evidence folder.

### Outside providers

Every provider that can receive private data. For each, the question is whether its own retention can satisfy FR-30; if it cannot, the limitation is **disclosed before the provider first receives private Project data** (for the payment provider, before the first payment), and the exception is recorded here.

| Provider | What it may hold | Proof of absence, or the disclosed exception | Run by, when |
| --- | --- | --- | --- |
| Supabase (Auth, Storage, Postgres, logs) | the data above | the Database, Storage, Backups and Logs proofs; the Auth user is deleted and the Admin API answers not found | the verifier after every purge; the Administrator at the canary |
| Backblaze B2 (backup and ledger buckets) | encrypted dumps and mirrored objects; the ledger (opaque identities only) | the Backups proof; the ledger keeps opaque IDs by design | the verifier at days 7, 15 and 30; the Administrator at drills |
| Vercel, Railway | function and service logs; Railway scratch is disposable | the Logs proof; scratch holds no authoritative data and is cleared when a Job ends, and a cancelled Job is proven by its cancellation record | the Administrator at the canary |
| Upstash (Redis, QStash) | rate-limit counters keyed by hashed origins; queue messages naming opaque IDs | counters and messages expire on their own and hold no private content; confirm no message names a deleted target after its TTL | the Administrator at the canary |
| Resend | the Administrator's recovery and alarm mail only | no private content is ever sent (see Notifications) | the Administrator at the canary |
| Stripe | payment records the provider must keep | the provider's own retention may not satisfy FR-30: **disclosed before the first payment**; only non-identifying aggregates remain on our side | recorded when payments ship (Story 2.16) |
| Research, search and AI providers | the research subject and the prompts sent to them | each provider's retention is recorded before it first receives private Project data; one that cannot satisfy FR-30 is disclosed first | recorded when each is adopted (Epic 3 onward) |
| Google | sign-in only; no Project data | none held | none |

- **Proof of absence:** for each provider, the entry in the table: either the proof (the Database, Storage, Backups and Logs proofs above for the providers that hold those stores, or expiry and the absence of private content for the rest) or the exception that was disclosed.
- **Run by:** as the table says; the Administrator owns this table and updates it when a provider is added.
- **When:** at adoption of a provider, and at the monthly canary for the proofs.
- **Evidence kept:** the provider's retention statement (a dated export or screenshot) in the Administrator's evidence folder, named in [the provisioning ledger](../provisioning/ledger.json) where an account is involved.

## The monthly canary, and the drills

A **canary** proves the whole path with synthetic data, so a real deletion is never the first test. Once a month the system creates a synthetic Account with a synthetic Workspace and Project, deletes it through an internal system-actor deletion (the same commands a person's confirmation runs), and then runs every proof above. It must show the deletion reaches the **database, Storage and the backups within 15 days**, judging backup absence from manifests and bucket listings because dumps are encrypted. It also proves **tombstone enforcement**: the synthetic Project's link, its status handle (`deleted` from the tombstone), and a late write all answer as a deleted target. The Administrator reviews the canary's record each month and signs it.

A **restore drill** (Stories 8.4 and 8.5) restores a dump into a dedicated project, shows the ledger is replayed before access opens, that every session grant and Auth session is revoked, that ledgered targets are scrubbed from the live copies, and that tombstoned IDs cannot be reused; the dedicated project is deleted afterwards.

## When a proof fails

A proof that finds a copy, or cannot be run, is a failed deletion. The target **stays tombstoned and hidden** (a tombstone is never undone); the verifier does not mark the deletion complete; an operational alarm is raised to the Administrator (Story 1.13); the missing store is added to the manifest or the leftover copy is purged and the proof run again; and the failure and its fix are recorded in the evidence folder. A store the manifest did not know about is a defect in this document and in the manifest, and both are corrected before the next deletion.

## Where the evidence is kept

| Evidence | Where | Holds |
| --- | --- | --- |
| The deletion manifest and the per-deletion verification record | the Lifecycle deletion record in the database (Story 8.2), kept with the tombstone. It is in the database, so **a restore can roll it back**: it is a working record, not the durable one | opaque IDs, keys and digests, counts and times |
| The tombstone and the ledger events | `lifecycle.tombstones`, `lifecycle.ledger_outbox`, and the ledger store (Story 8.9), which is outside every restore: **the ledger event is the durable record of a deletion**, and after a restore the verifier proves absence again (the replay of Story 8.4 re-applies the ledger, and the proofs above are run once more) | a tombstone's kind, ID, status handle, revision and time; the opaque change events (`account_authority`, `invitation_consumed`, `invitation_revoked`, `preauthorization_consumed`, `recovery_redeemed`, `tombstone`), keyed by the Account's, invitation's, pre-authorization's or recovery token's opaque ID |
| Listing digests, provider log searches, retention statements, drill and canary notes | the Administrator's evidence folder **outside the repository** | no private content; names of exports are recorded in `provisioning/ledger.json` as evidence |
| This procedure | `docs/deletion-verification.md` | the stores, the proofs, the runners |

## Review and sign-off

This document is reviewed and signed off by the Administrator **before Stories 8.1 to 8.3 start**, and again whenever a store, a provider or a retention changes. The sign-off is recorded as the provisioning item `hosted-status-check` (`provisioning/ledger.json`, due by Story 1.8) for the first review; later reviews are noted in the evidence folder.

| Review | By | Date | Result |
| --- | --- | --- | --- |
| First review, before any purge code ships | Administrator | not yet reviewed | pending |
