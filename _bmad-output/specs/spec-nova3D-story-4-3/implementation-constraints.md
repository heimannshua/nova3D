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

### FR-21

#### FR-21: Dependency-aware regeneration

nova3D can regenerate every Model Feature affected by an approved correction.

**Consequences:**
- All dependent geometry is rebuilt.
- Unrelated geometry remains geometrically unchanged within the defined reproducibility tolerance.
- The regenerated output is a new Model Version with intact provenance.

Source: PRD §4, FR-21.

**Ratified application:** R-2 equivalence and dependency-closure guarantees apply to evidence recipes. Direct-image changes preserve exact version/snapshot history and do not promise identical re-inference.

Source: `_bmad-output/planning-artifacts/epics.md`, line 332 in the captured input.

### FR-26

#### FR-26: Immediate automatic repair

When validation finds a fixable blocking failure, nova3D attempts an immediate repair and reruns all affected validation checks.

**Consequences:**
- Every repair records the detected problem, action taken, affected Model Features, and before-and-after result.
- If local repair fails, nova3D proceeds to FR-28 rather than looping indefinitely.

Source: PRD §4, FR-26.

**Ratified application:** R-3 / AR-12 permits only the listed bounded repair classes. A byte change always creates a new artifact; retaining the Model Version requires certified nonconsequential equivalence under R-2.

Source: `_bmad-output/planning-artifacts/epics.md`, line 395 in the captured input.

### AR-10

**AR-10: Certified equivalence.** Compare corresponding semantic features under the same original pinned final-print scale/orientation, tessellator/settings and comparator version, with no best-fit or independent rescaling. Require matching feature/component/closed-solid topology, conservative bidirectional surface-distance upper bound ≤0.01 mm, bounds delta ≤0.01 mm and relative volume delta ≤0.1% using reference absolute volume. Tiny/zero/ill-conditioned or inconclusive results block acceptance. Cover dimensions, thin features, holes, rotations, units and scale; coarse bounds/volume probes are not the certified comparator.

Source: R-2; AD-6, AD-7; G-2.

Source: `_bmad-output/planning-artifacts/epics.md`, line 611 in the captured input.

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
