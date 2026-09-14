# Implementation Constraints

Read the [project SPEC](../spec-nova3D/SPEC.md) and every companion it names recursively. Implement only this story's declared slice. Mapped requirements constrain the touched behavior; their other slices remain assigned to the other stories.

## Governing Interpretation

Ratified R-1–R-11 and approved SC-1–SC-7 override conflicting older PRD wording. Whole-plan approval and deterministic recipe equivalence apply to evidence_text/evidence_images. Direct image work uses confirmed ordered images/scope and acknowledged uncertainty, with honest inference provenance and restorable snapshots; it has no synthetic Research Plan or identical-reinference guarantee. Exact-model approval and required profile checks gate qualified export in every mode.

Prepared offline work follows the adopted no-lease/reconnect policy: learned disable locks until newer authoritative re-enable, learned tombstones purge before import, and network uncertainty alone is not deletion. R-11 permits one atomically consumed full fallback slot per lineage. The parent contract supplies every detailed authority, money, geometry, lifecycle and UX invariant.

## Mapped Requirements

### FR-19

#### FR-19: Feature-level evidence inspection

The user can select a Model Feature and inspect its complete evidence and decision context.

**Consequences:**
- The view includes linked Claims, Sources, Detail Status, supporting and conflicting evidence, reasoning, selected and rejected options, confidence explanation, Plan Approval, and the affected parameters.
- Navigation is bidirectional: a Model Feature reveals its Claims, and a Claim reveals every affected Model Feature.
- Evidence links remain stable through regeneration and Version restoration.

Source: PRD §4, FR-19.

**Ratified application:** For direct-image features expose image/inference provenance and uncertainty, with user-added features distinct. Do not invent historical claims to fill evidence navigation.

Source: `_bmad-output/planning-artifacts/epics.md`, line 307 in the captured input.

### AR-5

**AR-5: Provenance and immutable publication.** Preserve SourceRevision → ClaimRevision → Detail/Option → PlanRevision/PlanApproval → Parameter → Feature → ModelVersion → ModelApproval/Validation → Export links, including reverse navigation, competing choices, actors and times. Stable logical features have version-specific geometry/claim bindings. Artifacts owns one canonical JSON manifest-root/digest family with immutable ID, ownership, size, kind, byte digest, canonical serialization version, producing activity and child references. Approval, gateway access, restore, cleanup and deletion resolve the same manifest roots; object keys cannot redefine them. Staged output becomes usable/restorable only through verified coordinated publication.

Source: AD-4, AD-13; shared artifact identity.

Source: `_bmad-output/planning-artifacts/epics.md`, line 591 in the captured input.

### AR-9

**AR-9: Coordinate frames, measurement and versions.** Canonical content uses millimetres, right-handed coordinates and Z-up, retaining approved historical unit conversions. GLB explicitly converts to metres/Y-up; final-print scale/orientation is separately versioned. Every LOD preserves semantic feature IDs independently of triangles. Measurements use canonical geometry or labelled exact dimensions. Corrections rebuild dependency closure; restoration appends history and rechecks approval/profile validity without erasing successors.

Source: AD-7; FR-18–FR-22.

Source: `_bmad-output/planning-artifacts/epics.md`, line 607 in the captured input.

### NFR-3

**NFR-3: Provenance integrity.** Sources, Cached Research Revisions, Claims, decisions, approvals, repairs, validations, and derivative artifacts retain immutable identity, timestamps, actor, and version relationships. Every Claim pins the exact Source edition or revision, passage, retrieval date, and captured excerpt or content digest examined. Corrections and changed Source content use successor versions rather than mutation. Later printer integration cannot alter the approved evidence-to-geometry record.

Source: `_bmad-output/planning-artifacts/epics.md`, line 545 in the captured input.

### UX-DR7

**UX-DR7: Explicit workflow and evidence distinctions.** Keep sourced, inferred, disputed, unknown and user-added distinct; internal user_added maps to the display label user-added. Distinguish lead/evidence, cached/fresh dates, reconstruction/personalization, direct/evidence modes, Plan/Model Approval, preview/manufacturing geometry, warning/failure/unknown, Project source exclusion/Account disabling, and every Job/local-sync state.

Source: Screen inventory cross-surface states; UX-3; AD-3/AD-4.

Source: `_bmad-output/planning-artifacts/epics.md`, line 803 in the captured input.

### UX-DR50

**UX-DR50: Model Feature evidence (M-02).** Selecting a part reveals the exact Sources, Claims, interpretation, Detail Status, approvals, and affected geometry.

Required states/variants: Sourced, disputed, user-added Personalization, now-disabled Source warning.

Source: SCREEN-INVENTORY M-02; canonical ux-contract; applicable ratified decisions.

Source: `_bmad-output/planning-artifacts/epics.md`, line 1033 in the captured input.

### UX-DR51

**UX-DR51: Evidence-to-model navigation (M-03).** Select a Claim and reveal every affected Model Feature; return from feature to Claim.

Required states/variants: One-to-one, one-to-many, unavailable preview but intact provenance.

Source: SCREEN-INVENTORY M-03; canonical ux-contract; applicable ratified decisions.

Source: `_bmad-output/planning-artifacts/epics.md`, line 1039 in the captured input.

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
