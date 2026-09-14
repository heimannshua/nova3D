# Implementation Constraints

Read the [project SPEC](../spec-nova3D/SPEC.md) and every companion it names recursively. Implement only this story's declared slice. Mapped requirements constrain the touched behavior; their other slices remain assigned to the other stories.

## Governing Interpretation

Ratified R-1–R-11 and approved SC-1–SC-7 override conflicting older PRD wording. Whole-plan approval and deterministic recipe equivalence apply to evidence_text/evidence_images. Direct image work uses confirmed ordered images/scope and acknowledged uncertainty, with honest inference provenance and restorable snapshots; it has no synthetic Research Plan or identical-reinference guarantee. Exact-model approval and required profile checks gate qualified export in every mode.

Prepared offline work follows the adopted no-lease/reconnect policy: learned disable locks until newer authoritative re-enable, learned tombstones purge before import, and network uncertainty alone is not deletion. R-11 permits one atomically consumed full fallback slot per lineage. The parent contract supplies every detailed authority, money, geometry, lifecycle and UX invariant.

## Mapped Requirements

### FR-26

#### FR-26: Immediate automatic repair

When validation finds a fixable blocking failure, nova3D attempts an immediate repair and reruns all affected validation checks.

**Consequences:**
- Every repair records the detected problem, action taken, affected Model Features, and before-and-after result.
- If local repair fails, nova3D proceeds to FR-28 rather than looping indefinitely.

Source: PRD §4, FR-26.

**Ratified application:** R-3 / AR-12 permits only the listed bounded repair classes. A byte change always creates a new artifact; retaining the Model Version requires certified nonconsequential equivalence under R-2.

Source: `_bmad-output/planning-artifacts/epics.md`, line 395 in the captured input.

### FR-27

#### FR-27: Approval after substantive repair

If a repair changes visible geometry, historical dimensions, or Personalization, nova3D creates a new Model Version and requires inspection and Model Approval again.

**Consequences:**
- Export remains blocked until the repaired Version is approved and passes validation.
- Repairs that do not change those properties still remain in the validation audit history.

Source: PRD §4, FR-27.

Source: `_bmad-output/planning-artifacts/epics.md`, line 407 in the captured input.

### AR-10

**AR-10: Certified equivalence.** Compare corresponding semantic features under the same original pinned final-print scale/orientation, tessellator/settings and comparator version, with no best-fit or independent rescaling. Require matching feature/component/closed-solid topology, conservative bidirectional surface-distance upper bound ≤0.01 mm, bounds delta ≤0.01 mm and relative volume delta ≤0.1% using reference absolute volume. Tiny/zero/ill-conditioned or inconclusive results block acceptance. Cover dimensions, thin features, holes, rotations, units and scale; coarse bounds/volume probes are not the certified comparator.

Source: R-2; AD-6, AD-7; G-2.

Source: `_bmad-output/planning-artifacts/epics.md`, line 611 in the captured input.

### AR-12

**AR-12: Repair authority and one regeneration slot.** Every repaired byte representation gets a new artifact identity. Normals/winding fixes, duplicate/zero-area face removal or welding retain a Model Version only after R-2 proves nonconsequential equivalence. Hole filling, remeshing, thickening and dimension changes are consequential and require successor Model Version, inspection, approval and validation. Atomically consume unique (lineage_id, full_regeneration) with successor Job/outbox and any reservation; retries, cancellation, failure and children cannot rearm it. Evidence mode uses the approved plan; direct mode uses pinned original images/scope/engine, failed constraints and new settings digest, stopping if the engine cannot satisfy them.

Source: AD-8; R-3, R-11; G-3/G-8.

Source: `_bmad-output/planning-artifacts/epics.md`, line 619 in the captured input.

### NFR-3

**NFR-3: Provenance integrity.** Sources, Cached Research Revisions, Claims, decisions, approvals, repairs, validations, and derivative artifacts retain immutable identity, timestamps, actor, and version relationships. Every Claim pins the exact Source edition or revision, passage, retrieval date, and captured excerpt or content digest examined. Corrections and changed Source content use successor versions rather than mutation. Later printer integration cannot alter the approved evidence-to-geometry record.

Source: `_bmad-output/planning-artifacts/epics.md`, line 545 in the captured input.

### UX-DR17

**UX-DR17: Print-validation and bounded recovery states.** Expose exact profile/transform, check support, last-checked time, pass/warning/fail/unknown and stale results. Required unknowns block export. Show each repair and affected geometry; one full regeneration/reconversion is lineage-bound, preserves originals and returns to inspection/approval/validation. Failure after the allowed attempt stops with an actionable explanation.

Source: FR-24–FR-28; R-3/R-11.

Source: `_bmad-output/planning-artifacts/epics.md`, line 843 in the captured input.

### UX-DR60

**UX-DR60: Automatic repair (V-03).** Show repair target, result, affected geometry, and whether renewed Model Approval is needed.

Required states/variants: Local repair running/succeeded/failed, substantive versus non-substantive.

Source: SCREEN-INVENTORY V-03; canonical ux-contract; applicable ratified decisions.

Source: `_bmad-output/planning-artifacts/epics.md`, line 1093 in the captured input.

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
