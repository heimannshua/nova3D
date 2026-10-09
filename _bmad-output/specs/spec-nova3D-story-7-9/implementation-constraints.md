# Implementation Constraints

Read the [project SPEC](../spec-nova3D/SPEC.md) and every companion it names recursively. Implement only this story's declared slice. Mapped requirements constrain the touched behavior; their other slices remain assigned to the other stories.

## Governing Interpretation

Ratified R-1–R-12 and approved SC-1–SC-7 override conflicting older PRD wording. Whole-plan approval and deterministic recipe equivalence apply to evidence_text/evidence_images. Direct image work uses confirmed ordered images/scope and acknowledged uncertainty, with honest inference provenance and restorable snapshots; it has no synthetic Research Plan or identical-reinference guarantee. Exact-model approval and required profile checks gate qualified export in every mode.

Prepared offline work follows the adopted no-lease/reconnect policy: learned disable locks until newer authoritative re-enable, learned tombstones purge before import, and network uncertainty alone is not deletion. R-11 permits one atomically consumed full fallback slot per lineage. The parent contract supplies every detailed authority, money, geometry, lifecycle and UX invariant.

## Mapped Requirements

### AR-22

**AR-22: Prepared offline inference and sync.** Direct conversion uses a verified cached public app/model bundle in a dedicated worker, Account-scoped IndexedDB metadata and OPFS binary artifacts. R-8 selects ONNX Runtime Web 1.29.0 as the first browser backend with supported WebGPU or WASM execution; no reconstruction engine or weights are yet qualified. Qualify licensed/digest-pinned multi-view weights and the full preparation bundle at ≤500 MiB preparation download, ≤1 GiB working memory and ≤120 s conversion on R-5 devices, with held-out shape/coverage, eviction and interruption checks. Online preparation/export are required; no silent upload/cloud fallback. The one server run of the engine port is the user-requested pinned reconversion after failed print repair, a fenced Job from retained pictures with no provider charge. Sync stable UUIDs into the original Account with live status, expected revision, digest verification and idempotent import; retain conflicting versions for explicit selection.

Source: AD-16; R-8; G-8.

Source: `_bmad-output/planning-artifacts/epics.md`, line 702 in the captured input.

### NFR-1

**NFR-1: Workspace privacy.** Every user-facing and background operation enforces Account ownership. Cross-Account access to private Workspace data must produce no data disclosure.

Source: `_bmad-output/planning-artifacts/epics.md`, line 574 in the captured input.

### SC-1

##### SC-1: Picture workflows move into the first version

The PRD deferred picture workflows. The first version now includes both:

- **Direct picture-to-model:** labelled image-derived and not historically verified.
- **Research-assisted picture reconstruction:** identifies the subject, researches it, builds a complete Research Plan, and follows Plan Approval before evidence-backed generation.

Picture intake supports existing images, phone camera capture, and multiple images of one subject from different angles. Before conversion, nova3D checks clarity and angle coverage and recommends additional views. The user may choose **Generate anyway** after an explicit warning that incomplete views can cause invented or inaccurate geometry.

Source: UX-SCOPE-CHANGES SC-1; canonical ux-contract; applicable ratified decisions.

Source: `_bmad-output/planning-artifacts/epics.md`, line 516 in the captured input.

### SC-2

##### SC-2: Direct picture conversion works offline

Direct image-derived conversion must work without internet on supported computer and phone devices. Offline-created Projects remain usable locally, show pending or failed sync state, and automatically sync into **My Projects** when connectivity returns without duplication or overwriting a newer Model Version.

Research-assisted reconstruction remains online-only. R-8 adopts on-device limits, preparation and revocation behavior; G-8 still requires a qualifying engine, actual offline/device execution and sync evidence.

Source: UX-SCOPE-CHANGES SC-2; canonical ux-contract; applicable ratified decisions.

Source: `_bmad-output/planning-artifacts/epics.md`, line 527 in the captured input.

### SC-3

##### SC-3: Complete phone workflow

The first version supports the complete workflow on desktop, laptop, and phone. Phone is not a reduced companion: creation, research review, 3D inspection, approvals, validation, and downloads must all work.

Source: UX-SCOPE-CHANGES SC-3; canonical ux-contract; applicable ratified decisions.

Source: `_bmad-output/planning-artifacts/epics.md`, line 535 in the captured input.

### UX-DR9

**UX-DR9: Ordered multi-view image intake.** Support file selection and a phone Take photo action, requesting camera permission only after that action. Preview, add, replace, reorder and remove angles of one subject within one request; handle denied camera access and bad files. Choose direct image-derived versus online research-assisted reconstruction explicitly.

Source: SC-1; UX-2.

Source: `_bmad-output/planning-artifacts/epics.md`, line 844 in the captured input.

### UX-DR13

**UX-DR13: Prepared offline creation and honest failure.** Show preparation/download verification, missing preparation, storage unavailability, eviction/interruption and local inference failure as actionable states. Direct output remains saved/usable locally and labelled image-derived. Research-assisted mode is online-only; qualified export requires connection. Never silently upload or substitute paid cloud generation after local failure.

Source: SC-2; UX-4; R-8.

Source: `_bmad-output/planning-artifacts/epics.md`, line 860 in the captured input.

### UX-DR33

**UX-DR33: Picture intake (C-03).** Choose existing image; on phone, take a photo; add several angles.

Required states/variants: Permission prompt, permission denied, image previews, replace/reorder/remove, file error.

Source: SCREEN-INVENTORY C-03; canonical ux-contract; applicable ratified decisions.

Source: `_bmad-output/planning-artifacts/epics.md`, line 964 in the captured input.

### UX-DR34

**UX-DR34: Picture quality and coverage (C-04).** Explain blur, obstruction, or missing angles and recommend better/additional views.

Required states/variants: Sufficient, insufficient, additional view requested, **Generate anyway** warning.

Source: SCREEN-INVENTORY C-04; canonical ux-contract; applicable ratified decisions.

Source: `_bmad-output/planning-artifacts/epics.md`, line 970 in the captured input.

### UX-DR35

**UX-DR35: Picture path choice (C-05).** Choose direct image-derived conversion or research-assisted evidence-backed reconstruction.

Required states/variants: Plain explanation of accuracy difference, online/offline availability.

Source: SCREEN-INVENTORY C-05; canonical ux-contract; applicable ratified decisions.

Source: `_bmad-output/planning-artifacts/epics.md`, line 976 in the captured input.

### UX-DR36

**UX-DR36: Understood request (C-06).** Show subject, scope, intended outcome, picture mode, and Personalization; wait for confirmation.

Required states/variants: Clear, ambiguous with clarification questions, edit request, confirmed.

Source: SCREEN-INVENTORY C-06; canonical ux-contract; applicable ratified decisions.

Source: `_bmad-output/planning-artifacts/epics.md`, line 982 in the captured input.

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
