# Implementation Constraints

Read the [project SPEC](../spec-nova3D/SPEC.md) and every companion it names recursively. Implement only this story's declared slice. Mapped requirements constrain the touched behavior; their other slices remain assigned to the other stories.

## Governing Interpretation

Ratified R-1–R-11 and approved SC-1–SC-7 override conflicting older PRD wording. Whole-plan approval and deterministic recipe equivalence apply to evidence_text/evidence_images. Direct image work uses confirmed ordered images/scope and acknowledged uncertainty, with honest inference provenance and restorable snapshots; it has no synthetic Research Plan or identical-reinference guarantee. Exact-model approval and required profile checks gate qualified export in every mode.

Prepared offline work follows the adopted no-lease/reconnect policy: learned disable locks until newer authoritative re-enable, learned tombstones purge before import, and network uncertainty alone is not deletion. R-11 permits one atomically consumed full fallback slot per lineage. The parent contract supplies every detailed authority, money, geometry, lifecycle and UX invariant.

## Mapped Requirements

### FR-28

#### FR-28: Constrained full regeneration

If local repair cannot resolve printability, nova3D performs at most one full regeneration from the approved Research Plan using the Target Print Profile and failed validation constraints.

**Consequences:**
- The original Model Version and evidence chain remain available.
- The regenerated Model is a new Version requiring inspection, Model Approval, and validation.
- If that Version still fails, nova3D stops, explains the remaining problems, preserves every Version, and waits for the user to decide; no further automatic loop occurs.

Source: PRD §4, FR-28.

**Ratified application:** R-11 also allows at most one constrained full direct-image reconversion from the original pinned images/scope/engine and failed print constraints. Both modes atomically share the unresettable lineage slot across retries/children; a new Model Version requires inspection, approval and validation. An incapable engine or failed allowed attempt stops.

Source: `_bmad-output/planning-artifacts/epics.md`, line 417 in the captured input.

### AR-12

**AR-12: Repair authority and one regeneration slot.** Every repaired byte representation gets a new artifact identity. Normals/winding fixes, duplicate/zero-area face removal or welding retain a Model Version only after R-2 proves nonconsequential equivalence. Hole filling, remeshing, thickening and dimension changes are consequential and require successor Model Version, inspection, approval and validation. Atomically consume unique (lineage_id, full_regeneration) with successor Job/outbox and any reservation; retries, cancellation, failure and children cannot rearm it. Evidence mode uses the approved plan; direct mode uses pinned original images/scope/engine, failed constraints and new settings digest, stopping if the engine cannot satisfy them.

Source: AD-8; R-3, R-11; G-3/G-8.

Source: `_bmad-output/planning-artifacts/epics.md`, line 619 in the captured input.

### AR-22

**AR-22: Prepared offline inference and sync.** Direct conversion uses a verified cached public app/model bundle in a dedicated worker, Account-scoped IndexedDB metadata and OPFS binary artifacts. R-8 selects ONNX Runtime Web 1.29.0 as the first browser backend with supported WebGPU or WASM execution; no reconstruction engine or weights are yet qualified. Qualify licensed/digest-pinned multi-view weights and the full preparation bundle at ≤500 MiB preparation download, ≤1 GiB working memory and ≤120 s conversion on R-5 devices, with held-out shape/coverage, eviction and interruption checks. Online preparation/export are required; no silent upload/cloud fallback. The one server run of the engine port is the user-requested pinned reconversion after failed print repair, a fenced Job from retained pictures with no provider charge. Sync stable UUIDs into the original Account with live status, expected revision, digest verification and idempotent import; retain conflicting versions for explicit selection.

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

### UX-DR17

**UX-DR17: Print-validation and bounded recovery states.** Expose exact profile/transform, check support, last-checked time, pass/warning/fail/unknown and stale results. Required unknowns block export. Show each repair and affected geometry; one full regeneration/reconversion is lineage-bound, preserves originals and returns to inspection/approval/validation. Failure after the allowed attempt stops with an actionable explanation.

Source: FR-24–FR-28; R-3/R-11.

Source: `_bmad-output/planning-artifacts/epics.md`, line 843 in the captured input.

### UX-DR61

**UX-DR61: Full regeneration fallback (V-04).** At most one constrained attempt after local repair failure. R-11 applies the same one-attempt lineage rule to direct-image constrained reconversion.

Required states/variants: Running, new Version awaiting inspection/approval, failed and stopped.

Source: SCREEN-INVENTORY V-04; canonical ux-contract; applicable ratified decisions.

Source: `_bmad-output/planning-artifacts/epics.md`, line 1099 in the captured input.

### AR-14

**AR-14: Durable Jobs and bounded retries.** Accept Jobs only with committed dispatch outbox; persist Job → JobAttempt → StepExecution → ExternalOperation identities and receipts. Upstash orchestrates bounded HTTP steps and worker completions; Postgres owns state. Configure workflow, explicit queue publishes and provider SDKs for zero failed-work retries, verifying effective behavior with a deliberately failing research step. Duplicate transport returns existing receipts without repeated side effects; terminal failed/cancelled attempts cannot be reclaimed. Lease loss becomes interrupted failure; user retries create new linked attempts under the same Job and wait for prior potentially chargeable work to reconcile. Logical step keys are unique per attempt, and operation ordinals per step; Jobs owns receipts while Usage owns their ledger entries. Preserve last approved state and actionable failure details.

Source: AD-9; work/billing identity.

Source: `_bmad-output/planning-artifacts/epics.md`, line 637 in the captured input.

### AR-15

**AR-15: Fencing and authenticated service calls.** Each attempt binds input digest, Project revision, live Account authorization/evidence-policy epochs, lease and unique fencing token. Recheck before claim, each external step and publication. Cancel/disable/delete revoke commit authority before best-effort cancellation; stage output by attempt and clean it without publishing late results. Signed service requests bind environment, audience, Job/attempt, payload digest and nonce, expire within five minutes and allow at most 60 seconds skew. Verify native callback signatures and stored dispatch receipts; never infer callback identity from Project ID alone. Accept only the active signing key and one explicitly retiring key during the outstanding-request window; suspected compromise immediately revokes the key and affected leases. Reject replay mutations.

Source: AD-10; service authentication and delivery conventions.

Source: `_bmad-output/planning-artifacts/epics.md`, line 641 in the captured input.

### FR-7

#### FR-7: Actionable notifications

The app displays an app-wide Notification bar for Jobs and approval events.

**Consequences:**
- Notifications cover research readiness, generation completion or failure, Export readiness, and later printer events.
- Selecting a Notification opens the exact Project, approval item, failed Job, Export, or later printer event requiring attention.

Source: PRD §4, FR-7.

**Ratified application:** SC-5 adds first-version phone push for research, generation, validation and Export. Printing events remain inactive until later printer integration.

Source: `_bmad-output/planning-artifacts/epics.md`, line 157 in the captured input.

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
