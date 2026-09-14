# Implementation Constraints

Read the [project SPEC](../spec-nova3D/SPEC.md) and every companion it names recursively. Implement only this story's declared slice. Mapped requirements constrain the touched behavior; their other slices remain assigned to the other stories.

## Governing Interpretation

Ratified R-1–R-11 and approved SC-1–SC-7 override conflicting older PRD wording. Whole-plan approval and deterministic recipe equivalence apply to evidence_text/evidence_images. Direct image work uses confirmed ordered images/scope and acknowledged uncertainty, with honest inference provenance and restorable snapshots; it has no synthetic Research Plan or identical-reinference guarantee. Exact-model approval and required profile checks gate qualified export in every mode.

Prepared offline work follows the adopted no-lease/reconnect policy: learned disable locks until newer authoritative re-enable, learned tombstones purge before import, and network uncertainty alone is not deletion. R-11 permits one atomically consumed full fallback slot per lineage. The parent contract supplies every detailed authority, money, geometry, lifecycle and UX invariant.

## Mapped Requirements

### AR-22

**AR-22: Prepared offline inference and sync.** Direct conversion uses a verified cached public app/model bundle in a dedicated worker, Account-scoped IndexedDB metadata and OPFS binary artifacts. R-8 selects ONNX Runtime Web 1.29.0 as the first browser backend with supported WebGPU or WASM execution; no reconstruction engine or weights are yet qualified. Qualify licensed/digest-pinned multi-view weights and the full preparation bundle at ≤500 MiB preparation download, ≤1 GiB working memory and ≤120 s conversion on R-5 devices, with held-out shape/coverage, eviction and interruption checks. Online preparation/export are required; no silent upload/cloud fallback. Sync stable UUIDs into the original Account with live status, expected revision, digest verification and idempotent import; retain conflicting versions for explicit selection.

Source: AD-16; R-8; G-8.

Source: `_bmad-output/planning-artifacts/epics.md`, line 669 in the captured input.

### AR-23

**AR-23: Offline revocation state.** Already-local work remains usable while disconnected without a time lease. On contact, authoritative status precedes sync/export: disable locks stores and work; learned Account/Project tombstone purges affected files and pending commands. Only a newer server authorization epoch can unlock a known disable; stale replies, token refresh, connectivity or Account switching cannot. Network/auth uncertainty is not deletion. Sign-out clears private stores; never attach another Account's drafts or reuse deleted IDs. Disconnected/downloaded copies are outside controlled-backup erasure promises.

Source: AD-16; R-8.

Source: `_bmad-output/planning-artifacts/epics.md`, line 673 in the captured input.

### SC-2

##### SC-2: Direct picture conversion works offline

Direct image-derived conversion must work without internet on supported computer and phone devices. Offline-created Projects remain usable locally, show pending or failed sync state, and automatically sync into **My Projects** when connectivity returns without duplication or overwriting a newer Model Version.

Research-assisted reconstruction remains online-only. R-8 adopts on-device limits, preparation and revocation behavior; G-8 still requires a qualifying engine, actual offline/device execution and sync evidence.

Source: UX-SCOPE-CHANGES SC-2; canonical ux-contract; applicable ratified decisions.

Source: `_bmad-output/planning-artifacts/epics.md`, line 494 in the captured input.

### UX-DR13

**UX-DR13: Prepared offline creation and honest failure.** Show preparation/download verification, missing preparation, storage unavailability, eviction/interruption and local inference failure as actionable states. Direct output remains saved/usable locally and labelled image-derived. Research-assisted mode is online-only; qualified export requires connection. Never silently upload or substitute paid cloud generation after local failure.

Source: SC-2; UX-4; R-8.

Source: `_bmad-output/planning-artifacts/epics.md`, line 827 in the captured input.

### UX-DR14

**UX-DR14: Offline authority and conflict visibility.** Explain no offline time lease and revocation-on-reconnect during preparation. Show locally saved, pending, syncing, failed and conflict states; automatically import into original Account's My Projects without duplicates/overwrites. Learned disable locks until newer authoritative re-enable; learned deletion purges before import; network uncertainty preserves work. Sign-out clears private stores and Account switching never transfers drafts.

Source: UX-4; R-8.

Source: `_bmad-output/planning-artifacts/epics.md`, line 831 in the captured input.

### UX-DR31

**UX-DR31: Create entry (C-01).** Two equal first-version choices: **Enter text** and **Upload picture**.

Required states/variants: Desktop, phone, offline availability indication.

Source: SCREEN-INVENTORY C-01; canonical ux-contract; applicable ratified decisions.

Source: `_bmad-output/planning-artifacts/epics.md`, line 919 in the captured input.

### UX-DR38

**UX-DR38: Start confirmation (C-08).** Summarize the exact Job that will begin without duplicating Plan Approval.

Required states/variants: Ready, offline direct conversion, provider disclosure unresolved, insufficient allowance.

Source: SCREEN-INVENTORY C-08; canonical ux-contract; applicable ratified decisions.

Source: `_bmad-output/planning-artifacts/epics.md`, line 961 in the captured input.

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
