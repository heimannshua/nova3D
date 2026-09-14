# Implementation Constraints

Read the [project SPEC](../spec-nova3D/SPEC.md) and every companion it names recursively. Implement only this story's declared slice. Mapped requirements constrain the touched behavior; their other slices remain assigned to the other stories.

## Governing Interpretation

Ratified R-1–R-11 and approved SC-1–SC-7 override conflicting older PRD wording. Whole-plan approval and deterministic recipe equivalence apply to evidence_text/evidence_images. Direct image work uses confirmed ordered images/scope and acknowledged uncertainty, with honest inference provenance and restorable snapshots; it has no synthetic Research Plan or identical-reinference guarantee. Exact-model approval and required profile checks gate qualified export in every mode.

Prepared offline work follows the adopted no-lease/reconnect policy: learned disable locks until newer authoritative re-enable, learned tombstones purge before import, and network uncertainty alone is not deletion. R-11 permits one atomically consumed full fallback slot per lineage. The parent contract supplies every detailed authority, money, geometry, lifecycle and UX invariant.

## Mapped Requirements

### FR-17

#### FR-17: Plain-language personalization

The user can include or change Personalization through ordinary language, such as adding a name.

**Consequences:**
- Personalization is generated automatically without manual mesh editing.
- Every personalized Model Feature is visibly classified as user-added and cannot inherit evidence-backed status.
- Personalization must participate in inspection, versioning, Model Approval, and print validation.

Source: PRD §4, FR-17.

Source: `_bmad-output/planning-artifacts/epics.md`, line 286 in the captured input.

### AR-5

**AR-5: Provenance and immutable publication.** Preserve SourceRevision → ClaimRevision → Detail/Option → PlanRevision/PlanApproval → Parameter → Feature → ModelVersion → ModelApproval/Validation → Export links, including reverse navigation, competing choices, actors and times. Stable logical features have version-specific geometry/claim bindings. Artifacts owns one canonical JSON manifest-root/digest family with immutable ID, ownership, size, kind, byte digest, canonical serialization version, producing activity and child references. Approval, gateway access, restore, cleanup and deletion resolve the same manifest roots; object keys cannot redefine them. Staged output becomes usable/restorable only through verified coordinated publication.

Source: AD-4, AD-13; shared artifact identity.

Source: `_bmad-output/planning-artifacts/epics.md`, line 591 in the captured input.

### AR-8

**AR-8: Canonical native geometry.** Evidence-backed authority is a versioned declarative recipe with typed finite parameters, source-unit conversions, acyclic operation/dependency graph, stable feature IDs and trusted generator identity. Retain generator/dependency-lock/image digests, execution settings, recipe and BREP/STEP snapshots. CadQuery 2.8.0 uses the qualified Python 3.12.14/OCP closure; STEP alone is not the recipe. Unsupported geometry requires extending the trusted generator through code review. Direct inference retains exact immutable mesh/input/model/settings snapshots with no identical-reinference claim.

Source: AD-6; R-1; G-1.

Source: `_bmad-output/planning-artifacts/epics.md`, line 603 in the captured input.

### NFR-3

**NFR-3: Provenance integrity.** Sources, Cached Research Revisions, Claims, decisions, approvals, repairs, validations, and derivative artifacts retain immutable identity, timestamps, actor, and version relationships. Every Claim pins the exact Source edition or revision, passage, retrieval date, and captured excerpt or content digest examined. Corrections and changed Source content use successor versions rather than mutation. Later printer integration cannot alter the approved evidence-to-geometry record.

Source: `_bmad-output/planning-artifacts/epics.md`, line 545 in the captured input.

### UX-DR7

**UX-DR7: Explicit workflow and evidence distinctions.** Keep sourced, inferred, disputed, unknown and user-added distinct; internal user_added maps to the display label user-added. Distinguish lead/evidence, cached/fresh dates, reconstruction/personalization, direct/evidence modes, Plan/Model Approval, preview/manufacturing geometry, warning/failure/unknown, Project source exclusion/Account disabling, and every Job/local-sync state.

Source: Screen inventory cross-surface states; UX-3; AD-3/AD-4.

Source: `_bmad-output/planning-artifacts/epics.md`, line 803 in the captured input.

### UX-DR46

**UX-DR46: Consequential Detail review (R-03).** Claim, exact Source, reasoning, Detail Status, expected geometry effect.

Required states/variants: `sourced`, `inferred`, `disputed`, `unknown`, `user-added`.

Source: SCREEN-INVENTORY R-03; canonical ux-contract; applicable ratified decisions.

Source: `_bmad-output/planning-artifacts/epics.md`, line 1009 in the captured input.

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
