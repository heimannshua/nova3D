# Implementation Constraints

Read the [project SPEC](../spec-nova3D/SPEC.md) and every companion it names recursively. Implement only this story's declared slice. Mapped requirements constrain the touched behavior; their other slices remain assigned to the other stories.

## Governing Interpretation

Ratified R-1–R-11 and approved SC-1–SC-7 override conflicting older PRD wording. Whole-plan approval and deterministic recipe equivalence apply to evidence_text/evidence_images. Direct image work uses confirmed ordered images/scope and acknowledged uncertainty, with honest inference provenance and restorable snapshots; it has no synthetic Research Plan or identical-reinference guarantee. Exact-model approval and required profile checks gate qualified export in every mode.

Prepared offline work follows the adopted no-lease/reconnect policy: learned disable locks until newer authoritative re-enable, learned tombstones purge before import, and network uncertainty alone is not deletion. R-11 permits one atomically consumed full fallback slot per lineage. The parent contract supplies every detailed authority, money, geometry, lifecycle and UX invariant.

## Mapped Requirements

### FR-15

#### FR-15: Approved-plan generation

nova3D can generate the complete Canonical Model automatically from the approved Research Plan without manual modelling.

**Consequences:**
- Generation uses only the exact Research Plan version authorized by Plan Approval.
- Generation is blocked if approval is missing, invalidated, or belongs to another version.
- The resulting Model Version records the governing Research Plan, parameters, units, generation activity, and tool or model versions needed to explain its origin.

Source: PRD §4, FR-15.

**Ratified application:** This approved-plan generation contract applies to evidence-backed geometry. Direct conversion uses pinned image/scope/engine provenance and retains the same model-inspection, exact-model approval and print-validation obligations.

Source: `_bmad-output/planning-artifacts/epics.md`, line 260 in the captured input.

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

### AR-2

**AR-2: Module boundaries and ownership.** Use a modular monolith with provider-neutral domain ports and versioned subject packages. Next.js handles commands/web delivery; trusted Railway native workers handle geometry/validation/export and large-file delivery. Models propose validated data, never executable scripts. Retain the architecture's sole ownership of Identity, Projects, Evidence, Geometry, Manufacturing, Artifacts, Jobs, Usage, Preferences/notifications and Lifecycle records; shared invariants use coordinated Postgres transactions.

Source: AD-1, AD-2; Structural Seed.

Source: `_bmad-output/planning-artifacts/epics.md`, line 579 in the captured input.

### AR-8

**AR-8: Canonical native geometry.** Evidence-backed authority is a versioned declarative recipe with typed finite parameters, source-unit conversions, acyclic operation/dependency graph, stable feature IDs and trusted generator identity. Retain generator/dependency-lock/image digests, execution settings, recipe and BREP/STEP snapshots. CadQuery 2.8.0 uses the qualified Python 3.12.14/OCP closure; STEP alone is not the recipe. Unsupported geometry requires extending the trusted generator through code review. Direct inference retains exact immutable mesh/input/model/settings snapshots with no identical-reinference claim.

Source: AD-6; R-1; G-1.

Source: `_bmad-output/planning-artifacts/epics.md`, line 603 in the captured input.

### AR-9

**AR-9: Coordinate frames, measurement and versions.** Canonical content uses millimetres, right-handed coordinates and Z-up, retaining approved historical unit conversions. GLB explicitly converts to metres/Y-up; final-print scale/orientation is separately versioned. Every LOD preserves semantic feature IDs independently of triangles. Measurements use canonical geometry or labelled exact dimensions. Corrections rebuild dependency closure; restoration appends history and rechecks approval/profile validity without erasing successors.

Source: AD-7; FR-18–FR-22.

Source: `_bmad-output/planning-artifacts/epics.md`, line 607 in the captured input.

### NFR-3

**NFR-3: Provenance integrity.** Sources, Cached Research Revisions, Claims, decisions, approvals, repairs, validations, and derivative artifacts retain immutable identity, timestamps, actor, and version relationships. Every Claim pins the exact Source edition or revision, passage, retrieval date, and captured excerpt or content digest examined. Corrections and changed Source content use successor versions rather than mutation. Later printer integration cannot alter the approved evidence-to-geometry record.

Source: `_bmad-output/planning-artifacts/epics.md`, line 545 in the captured input.

### NFR-6

**NFR-6: Reproducibility.** Given fixed approved inputs, tool versions, and settings, nova3D reproduces geometrically equivalent Canonical Models within the tolerance ratified through AD-2.

Ratified application: this is evidence-recipe equivalence under R-2 / AR-10. The PRD's AD-2 means PRD:AD-2, not architecture AD-2. Direct inference preserves exact snapshots/provenance without an identical-reinference guarantee.

Source: `_bmad-output/planning-artifacts/epics.md`, line 551 in the captured input.

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
