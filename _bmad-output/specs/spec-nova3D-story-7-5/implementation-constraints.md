# Implementation Constraints

Read the [project SPEC](../spec-nova3D/SPEC.md) and every companion it names recursively. Implement only this story's declared slice. Mapped requirements constrain the touched behavior; their other slices remain assigned to the other stories.

## Governing Interpretation

Ratified R-1–R-11 and approved SC-1–SC-7 override conflicting older PRD wording. Whole-plan approval and deterministic recipe equivalence apply to evidence_text/evidence_images. Direct image work uses confirmed ordered images/scope and acknowledged uncertainty, with honest inference provenance and restorable snapshots; it has no synthetic Research Plan or identical-reinference guarantee. Exact-model approval and required profile checks gate qualified export in every mode.

Prepared offline work follows the adopted no-lease/reconnect policy: learned disable locks until newer authoritative re-enable, learned tombstones purge before import, and network uncertainty alone is not deletion. R-11 permits one atomically consumed full fallback slot per lineage. The parent contract supplies every detailed authority, money, geometry, lifecycle and UX invariant.

## Mapped Requirements

### FR-3

#### FR-3: Account administration

The Administrator can view Account status and disable or re-enable an invited Account.

**Consequences:**
- Disabling an Account immediately revokes every active session and download authorization.
- A disabled Account cannot authenticate, access its Workspace, or start operations or paid steps.
- Disabling safely cancels active Jobs and rejects any late result so it cannot mutate Workspace or cache state.
- Disabling an Account does not delete its Workspace.
- Administrative capabilities are limited to issuing and revoking Invitation Codes, viewing account status and usage, setting Usage Limits, and disabling or re-enabling Accounts.
- Invitation, Usage Limit, disable, re-enable, and recovery actions require fresh Administrator authentication and create immutable security audit events.
- The unique Administrator can recover access only through a single-use, short-lived link sent to the Administrator's verified email address.
- Successful Administrator recovery revokes all existing Administrator sessions and creates an immutable recovery audit event.

Source: PRD §4, FR-3.

**Ratified application:** R-8 / AR-23 governs already-local disconnected data: server access is revoked immediately, while a disconnected device learns disable/deletion on contact. A learned disable cannot be bypassed by returning offline.

Source: `_bmad-output/planning-artifacts/epics.md`, line 96 in the captured input.

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

### AR-23

**AR-23: Offline revocation state.** Already-local work remains usable while disconnected without a time lease. On contact, authoritative status precedes sync/export: disable locks stores and work; learned Account/Project tombstone purges affected files and pending commands. Only a newer server authorization epoch can unlock a known disable; stale replies, token refresh, connectivity or Account switching cannot. Network/auth uncertainty is not deletion. Sign-out clears private stores; never attach another Account's drafts or reuse deleted IDs. Disconnected/downloaded copies are outside controlled-backup erasure promises.

Source: AD-16; R-8.

Source: `_bmad-output/planning-artifacts/epics.md`, line 673 in the captured input.

### NFR-1

**NFR-1: Workspace privacy.** Every user-facing and background operation enforces Account ownership. Cross-Account access to private Workspace data must produce no data disclosure.

Source: `_bmad-output/planning-artifacts/epics.md`, line 541 in the captured input.

### NFR-12

**NFR-12: Privacy-preserving cache and deletion.** Shared cached research contains only fields reproducible from identified non-private Sources and cannot expose user identity, private inputs, decisions, or deleted artifacts. Admission rejects all user- and Project-derived fields. Project or whole-Account deletion takes effect immediately through durable tombstones. It blocks late writes and cache promotion, promptly removes active private data, removes remaining copies from operational backups within 30 days, and remains enforced after backup restoration.

Source: PRD §7. All twelve NFRs apply across the capability set, with the explicit mode distinction above. Architecture requirements below supply measurable limits and enforcement contracts.

Source: `_bmad-output/planning-artifacts/epics.md`, line 565 in the captured input.

### SC-2

##### SC-2: Direct picture conversion works offline

Direct image-derived conversion must work without internet on supported computer and phone devices. Offline-created Projects remain usable locally, show pending or failed sync state, and automatically sync into **My Projects** when connectivity returns without duplication or overwriting a newer Model Version.

Research-assisted reconstruction remains online-only. R-8 adopts on-device limits, preparation and revocation behavior; G-8 still requires a qualifying engine, actual offline/device execution and sync evidence.

Source: UX-SCOPE-CHANGES SC-2; canonical ux-contract; applicable ratified decisions.

Source: `_bmad-output/planning-artifacts/epics.md`, line 494 in the captured input.

### UX-DR14

**UX-DR14: Offline authority and conflict visibility.** Explain no offline time lease and revocation-on-reconnect during preparation. Show locally saved, pending, syncing, failed and conflict states; automatically import into original Account's My Projects without duplicates/overwrites. Learned disable locks until newer authoritative re-enable; learned deletion purges before import; network uncertainty preserves work. Sign-out clears private stores and Account switching never transfers drafts.

Source: UX-4; R-8.

Source: `_bmad-output/planning-artifacts/epics.md`, line 831 in the captured input.

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
