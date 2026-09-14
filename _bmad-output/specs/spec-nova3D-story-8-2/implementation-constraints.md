# Implementation Constraints

Read the [project SPEC](../spec-nova3D/SPEC.md) and every companion it names recursively. Implement only this story's declared slice. Mapped requirements constrain the touched behavior; their other slices remain assigned to the other stories.

## Governing Interpretation

Ratified R-1–R-11 and approved SC-1–SC-7 override conflicting older PRD wording. Whole-plan approval and deterministic recipe equivalence apply to evidence_text/evidence_images. Direct image work uses confirmed ordered images/scope and acknowledged uncertainty, with honest inference provenance and restorable snapshots; it has no synthetic Research Plan or identical-reinference guarantee. Exact-model approval and required profile checks gate qualified export in every mode.

Prepared offline work follows the adopted no-lease/reconnect policy: learned disable locks until newer authoritative re-enable, learned tombstones purge before import, and network uncertainty alone is not deletion. R-11 permits one atomically consumed full fallback slot per lineage. The parent contract supplies every detailed authority, money, geometry, lifecycle and UX invariant.

## Mapped Requirements

### FR-30

#### FR-30: Private Project or Account deletion with non-user-visible research cache

An Account owner can permanently delete individual Projects and Exports or the complete Account and private Workspace after fresh authentication and explicit confirmation.

**Shared deletion guarantees**

- nova3D tombstones and hides the deletion target before cancellation or cleanup begins.
- Deletion cancels affected Jobs and rejects late worker writes and cache promotion so deleted data cannot reappear.
- Active private data is removed promptly. Remaining private copies in operational backups are removed within 30 days.
- Deletion tombstones survive backup restoration and prevent restored private data from becoming active or accessible.
- Any outside provider whose retention cannot satisfy these deletion guarantees must be disclosed before it receives private Project data.

**Project and Export deletion**

- Deletion removes Models, Exports, Personalization, approvals, private prompt wording beyond the normalized research subject, and private Project history from active private storage.

**Permitted shared-cache retention**

- nova3D may retain source-derived Claims and provenance in a shared research cache available to all Accounts.
- A Cached Research Revision may contain only fields reproducible from identified non-private Sources. It cannot contain or reveal Account identity, private prompt wording beyond a normalized research subject, uploaded private material, Personalization, Project decisions, Models, deleted files, or which Account requested a subject.
- Every cached Claim is pinned to immutable Source and Cached Research Revision identities. Corrections create linked successor revisions and cannot silently change evidence already approved by a Project.
- No Account can browse another Account's deleted files or private history through the cache. Reuse cannot recreate a deleted Project or its private decisions.

**Account deletion and instance closure**

- Whole-Account deletion immediately disables access and applies the shared guarantees to every Project, Job, Notification, Export, upload, Personalization item, usage-linked identifier, temporary artifact, and private operational record in that Workspace.
- Only Cached Research Revisions allowed above may remain, and they cannot reveal that the deleted Account requested or used them.
- Because the Administrator role is unique and non-transferable in the MVP, ordinary Administrator self-deletion is blocked while an invited Account exists.
- A separate close-instance action remains available after fresh Administrator authentication and explicit destructive confirmation. It tombstones every Account and Workspace without exposing their contents, revokes all sessions and Invitation Codes, cancels all Jobs, rejects late writes, and applies the shared deletion guarantees.
- When no invited Account remains, Administrator self-deletion performs the same close-instance action.

Source: PRD §4, FR-30.

**Ratified application:** R-9 sets active purge at no more than 24 hours and controlled-backup expiry at no more than 30 days from deletion, with deletion-ledger replay before reopening restored access. R-8 excludes disconnected/downloaded copies from remote erasure promises and requires learned tombstones to purge before sync.

Source: `_bmad-output/planning-artifacts/epics.md`, line 444 in the captured input.

### AR-18

**AR-18: Identity and administrative enforcement.** Disable public Supabase signup; hash/atomically claim invitations and idempotently provision Auth plus Workspace with unusable partial activation. Rate-limit guessing; rotate shared codes only after success. Verify JWT plus live Account and session grant on every private path, including direct RLS/storage access. The sole Administrator cannot impersonate, inspect private Workspaces or grant more administrators. Sensitive actions require fresh authentication and immutable audit; verified-email single-use short-lived recovery revokes prior sessions.

Source: AD-12; FR-1–FR-4.

Source: `_bmad-output/planning-artifacts/epics.md`, line 653 in the captured input.

### AR-21

**AR-21: Deletion and tested recovery.** Tombstone/hide before cancellation/purge; cover database, images, models, exports, staging, notifications, usage associations and private operational records. Active purge ≤24 h; all controlled private backup copies expire ≤30 days from deletion, never extended by restore/rebackup. Back up database daily and objects independently; target RPO/RTO ≤24 h. Persist the minimum restricted anti-resurrection ledger of opaque target identities outside restore rollback and replay before reopening access. Verify interrupted cross-store deletion and restore; apart from that minimum ledger, preserve only permitted public claims/nonidentifying aggregates. Apply sole-Administrator close-instance safeguards and disclose external retention exceptions.

Source: AD-15; R-9; FR-30; G-9.

Source: `_bmad-output/planning-artifacts/epics.md`, line 665 in the captured input.

### NFR-1

**NFR-1: Workspace privacy.** Every user-facing and background operation enforces Account ownership. Cross-Account access to private Workspace data must produce no data disclosure.

Source: `_bmad-output/planning-artifacts/epics.md`, line 541 in the captured input.

### NFR-12

**NFR-12: Privacy-preserving cache and deletion.** Shared cached research contains only fields reproducible from identified non-private Sources and cannot expose user identity, private inputs, decisions, or deleted artifacts. Admission rejects all user- and Project-derived fields. Project or whole-Account deletion takes effect immediately through durable tombstones. It blocks late writes and cache promotion, promptly removes active private data, removes remaining copies from operational backups within 30 days, and remains enforced after backup restoration.

Source: PRD §7. All twelve NFRs apply across the capability set, with the explicit mode distinction above. Architecture requirements below supply measurable limits and enforcement contracts.

Source: `_bmad-output/planning-artifacts/epics.md`, line 565 in the captured input.

### UX-DR19

**UX-DR19: Failure and destructive-action clarity.** For failures show stage, known cause, preserved state, known cost impact and permitted next action, with no automatic retry implied. Sensitive/deletion/instance-closure flows show required fresh authentication, exact consequences and explicit confirmation; immediate hidden/tombstoned state remains distinct from cleanup completion.

Source: NFR-8; FR-3/FR-6/FR-30; screen inventory.

Source: `_bmad-output/planning-artifacts/epics.md`, line 851 in the captured input.

### UX-DR68

**UX-DR68: Account deletion (S-05).** Fresh authentication, explicit consequences, immediate tombstone and 30-day backup removal.

Required states/variants: Confirmation, blocked/error, signed out/deletion underway.

Source: SCREEN-INVENTORY S-05; canonical ux-contract; applicable ratified decisions.

Source: `_bmad-output/planning-artifacts/epics.md`, line 1141 in the captured input.

### UX-DR73

**UX-DR73: Close instance (AD-05).** Destructive action without viewing private Workspace contents.

Required states/variants: Fresh authentication, explicit destructive confirmation, closing, complete.

Source: SCREEN-INVENTORY AD-05; canonical ux-contract; applicable ratified decisions.

Source: `_bmad-output/planning-artifacts/epics.md`, line 1171 in the captured input.

## Planning Assumptions

- Story boundaries and the proposed order are delegated fast-path planning choices inferred from ratified requirements, not separately claimed user approvals.
- Evidence-backed generation and export can be implemented without waiting for the direct reconstruction engine; full first-version release still requires both picture modes and qualified offline/device behavior.
- Each story creates only the records and interfaces needed by its slice; later features inherit live authorization, immutable provenance, money, lifecycle and accessible UI contracts.
- Per-story specs have local stable CAP IDs and adopt the unchanged project-wide contract. No implementation dispatch, spec_checkpoint or done_checkpoint defaults are set in this planning run.
- Exact compatible patches, deployed resources, licensed font files and reconstruction weights remain delegated selections within adopted limits; missing qualifying evidence is engineering work, not a newly invented product question.

## Qualification Snapshot — September 14, 2026

| Gate | Recorded status |
| --- | --- |
| G-1 | PARTIAL |
| G-2 | PARTIAL |
| G-3 | PARTIAL |
| G-4 | NOT RUN |
| G-5 | BLOCKED |
| G-6 | PARTIAL |
| G-7 | NOT RUN |
| G-8 | BLOCKED |
| G-9 | PARTIAL |

Only actual qualifying evidence changes these statuses. Creating or validating a story spec does not pass an engineering gate. A missing offline engine or device result remains release-blocking under the adopted scope.
