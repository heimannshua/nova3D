# Implementation Constraints

Read the [project SPEC](../spec-nova3D/SPEC.md) and every companion it names recursively. Implement only this story's declared slice. Mapped requirements constrain the touched behavior; their other slices remain assigned to the other stories.

## Governing Interpretation

Ratified R-1–R-11 and approved SC-1–SC-7 override conflicting older PRD wording. Whole-plan approval and deterministic recipe equivalence apply to evidence_text/evidence_images. Direct image work uses confirmed ordered images/scope and acknowledged uncertainty, with honest inference provenance and restorable snapshots; it has no synthetic Research Plan or identical-reinference guarantee. Exact-model approval and required profile checks gate qualified export in every mode.

Prepared offline work follows the adopted no-lease/reconnect policy: learned disable locks until newer authoritative re-enable, learned tombstones purge before import, and network uncertainty alone is not deletion. R-11 permits one atomically consumed full fallback slot per lineage. The parent contract supplies every detailed authority, money, geometry, lifecycle and UX invariant.

## Mapped Requirements

### FR-16

#### FR-16: Reproducible canonical model

nova3D preserves a Canonical Model representation from which approved geometry can be regenerated reproducibly.

**Consequences:**
- Identical approved inputs, governing tool versions, and generation settings must produce geometrically equivalent output within a defined tolerance.
- Probabilistic research or drafting output is not itself the Canonical Model.
- Exported print files do not replace or erase the Canonical Model history.

Source: PRD §4, FR-16.

**Ratified application:** Deterministic equivalence applies to evidence-backed recipes under R-2. Direct inference instead preserves exact input/activity/output identities and restorable snapshots; identical re-inference is not promised.

Source: `_bmad-output/planning-artifacts/epics.md`, line 273 in the captured input.

### FR-17

#### FR-17: Plain-language personalization

The user can include or change Personalization through ordinary language, such as adding a name.

**Consequences:**
- Personalization is generated automatically without manual mesh editing.
- Every personalized Model Feature is visibly classified as user-added and cannot inherit evidence-backed status.
- Personalization must participate in inspection, versioning, Model Approval, and print validation.

Source: PRD §4, FR-17.

Source: `_bmad-output/planning-artifacts/epics.md`, line 286 in the captured input.

### AR-4

**AR-4: Explicit request modes.** Persist immutable evidence_text, evidence_images or image_direct revisions. Evidence modes need complete whole-plan approval of the exact digest. Direct mode needs confirmed scope, ordered image digests and acknowledged uncertainty, and never gains historical status. Changing modes creates a successor request. Every qualified export still requires exact-model approval and compatible validation.

Source: AD-3; R-8, R-11; scope-and-readiness.

Source: `_bmad-output/planning-artifacts/epics.md`, line 587 in the captured input.

### AR-5

**AR-5: Provenance and immutable publication.** Preserve SourceRevision → ClaimRevision → Detail/Option → PlanRevision/PlanApproval → Parameter → Feature → ModelVersion → ModelApproval/Validation → Export links, including reverse navigation, competing choices, actors and times. Stable logical features have version-specific geometry/claim bindings. Artifacts owns one canonical JSON manifest-root/digest family with immutable ID, ownership, size, kind, byte digest, canonical serialization version, producing activity and child references. Approval, gateway access, restore, cleanup and deletion resolve the same manifest roots; object keys cannot redefine them. Staged output becomes usable/restorable only through verified coordinated publication.

Source: AD-4, AD-13; shared artifact identity.

Source: `_bmad-output/planning-artifacts/epics.md`, line 591 in the captured input.

### AR-22

**AR-22: Prepared offline inference and sync.** Direct conversion uses a verified cached public app/model bundle in a dedicated worker, Account-scoped IndexedDB metadata and OPFS binary artifacts. R-8 selects ONNX Runtime Web 1.29.0 as the first browser backend with supported WebGPU or WASM execution; no reconstruction engine or weights are yet qualified. Qualify licensed/digest-pinned multi-view weights and the full preparation bundle at ≤500 MiB preparation download, ≤1 GiB working memory and ≤120 s conversion on R-5 devices, with held-out shape/coverage, eviction and interruption checks. Online preparation/export are required; no silent upload/cloud fallback. Sync stable UUIDs into the original Account with live status, expected revision, digest verification and idempotent import; retain conflicting versions for explicit selection.

Source: AD-16; R-8; G-8.

Source: `_bmad-output/planning-artifacts/epics.md`, line 669 in the captured input.

### SC-1

##### SC-1: Picture workflows move into the first version

The PRD deferred picture workflows. The first version now includes both:

- **Direct picture-to-model:** labelled image-derived and not historically verified.
- **Research-assisted picture reconstruction:** identifies the subject, researches it, builds a complete Research Plan, and follows Plan Approval before evidence-backed generation.

Picture intake supports existing images, phone camera capture, and multiple images of one subject from different angles. Before conversion, nova3D checks clarity and angle coverage and recommends additional views. The user may choose **Generate anyway** after an explicit warning that incomplete views can cause invented or inaccurate geometry.

Source: UX-SCOPE-CHANGES SC-1; canonical ux-contract; applicable ratified decisions.

Source: `_bmad-output/planning-artifacts/epics.md`, line 483 in the captured input.

### SC-2

##### SC-2: Direct picture conversion works offline

Direct image-derived conversion must work without internet on supported computer and phone devices. Offline-created Projects remain usable locally, show pending or failed sync state, and automatically sync into **My Projects** when connectivity returns without duplication or overwriting a newer Model Version.

Research-assisted reconstruction remains online-only. R-8 adopts on-device limits, preparation and revocation behavior; G-8 still requires a qualifying engine, actual offline/device execution and sync evidence.

Source: UX-SCOPE-CHANGES SC-2; canonical ux-contract; applicable ratified decisions.

Source: `_bmad-output/planning-artifacts/epics.md`, line 494 in the captured input.

### SC-3

##### SC-3: Complete phone workflow

The first version supports the complete workflow on desktop, laptop, and phone. Phone is not a reduced companion: creation, research review, 3D inspection, approvals, validation, and downloads must all work.

Source: UX-SCOPE-CHANGES SC-3; canonical ux-contract; applicable ratified decisions.

Source: `_bmad-output/planning-artifacts/epics.md`, line 502 in the captured input.

### UX-DR7

**UX-DR7: Explicit workflow and evidence distinctions.** Keep sourced, inferred, disputed, unknown and user-added distinct; internal user_added maps to the display label user-added. Distinguish lead/evidence, cached/fresh dates, reconstruction/personalization, direct/evidence modes, Plan/Model Approval, preview/manufacturing geometry, warning/failure/unknown, Project source exclusion/Account disabling, and every Job/local-sync state.

Source: Screen inventory cross-surface states; UX-3; AD-3/AD-4.

Source: `_bmad-output/planning-artifacts/epics.md`, line 803 in the captured input.

### UX-DR13

**UX-DR13: Prepared offline creation and honest failure.** Show preparation/download verification, missing preparation, storage unavailability, eviction/interruption and local inference failure as actionable states. Direct output remains saved/usable locally and labelled image-derived. Research-assisted mode is online-only; qualified export requires connection. Never silently upload or substitute paid cloud generation after local failure.

Source: SC-2; UX-4; R-8.

Source: `_bmad-output/planning-artifacts/epics.md`, line 827 in the captured input.

### UX-DR35

**UX-DR35: Picture path choice (C-05).** Choose direct image-derived conversion or research-assisted evidence-backed reconstruction.

Required states/variants: Plain explanation of accuracy difference, online/offline availability.

Source: SCREEN-INVENTORY C-05; canonical ux-contract; applicable ratified decisions.

Source: `_bmad-output/planning-artifacts/epics.md`, line 943 in the captured input.

### UX-DR50

**UX-DR50: Model Feature evidence (M-02).** Selecting a part reveals the exact Sources, Claims, interpretation, Detail Status, approvals, and affected geometry.

Required states/variants: Sourced, disputed, user-added Personalization, now-disabled Source warning.

Source: SCREEN-INVENTORY M-02; canonical ux-contract; applicable ratified decisions.

Source: `_bmad-output/planning-artifacts/epics.md`, line 1033 in the captured input.

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
