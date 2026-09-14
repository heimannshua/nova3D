# Implementation Constraints

Read the [project SPEC](../spec-nova3D/SPEC.md) and every companion it names recursively. Implement only this story's declared slice. Mapped requirements constrain the touched behavior; their other slices remain assigned to the other stories.

## Governing Interpretation

Ratified R-1–R-11 and approved SC-1–SC-7 override conflicting older PRD wording. Whole-plan approval and deterministic recipe equivalence apply to evidence_text/evidence_images. Direct image work uses confirmed ordered images/scope and acknowledged uncertainty, with honest inference provenance and restorable snapshots; it has no synthetic Research Plan or identical-reinference guarantee. Exact-model approval and required profile checks gate qualified export in every mode.

Prepared offline work follows the adopted no-lease/reconnect policy: learned disable locks until newer authoritative re-enable, learned tombstones purge before import, and network uncertainty alone is not deletion. R-11 permits one atomically consumed full fallback slot per lineage. The parent contract supplies every detailed authority, money, geometry, lifecycle and UX invariant.

## Mapped Requirements

### FR-24

#### FR-24: Target print profile

Before validation, the user selects the intended printer, material, and physical model size as the Target Print Profile.

**Consequences:**
- The MVP fixture profile is a Bambu Lab A1 mini with its standard 0.4 mm nozzle, gold silk PLA, and a maximum 90 × 90 × 90 mm model envelope.
- Validation results and the Source Record identify the exact Target Print Profile.
- A change to the Target Print Profile requires validation to run again.

Source: PRD §4, FR-24.

Source: `_bmad-output/planning-artifacts/epics.md`, line 370 in the captured input.

### AR-9

**AR-9: Coordinate frames, measurement and versions.** Canonical content uses millimetres, right-handed coordinates and Z-up, retaining approved historical unit conversions. GLB explicitly converts to metres/Y-up; final-print scale/orientation is separately versioned. Every LOD preserves semantic feature IDs independently of triangles. Measurements use canonical geometry or labelled exact dimensions. Corrections rebuild dependency closure; restoration appends history and rechecks approval/profile validity without erasing successors.

Source: AD-7; FR-18–FR-22.

Source: `_bmad-output/planning-artifacts/epics.md`, line 607 in the captured input.

### AR-11

**AR-11: Exact print profile and fail-closed checks.** Pin the manufacturer profile's complete inheritance closure for A1 mini 0.4 mm, Bambu PLA Silk+ Gold, ≤90 mm cube, 0.20 mm layers and an explicit three-perimeter override. Enforce wall ≥1.2 mm, isolated feature ≥0.8 mm, clearance ≥0.4 mm and relief ≥0.6 mm. Overhang >45° from vertical or bridge >5 mm requires verified support/slicing analysis. Validation binds model digest, profile revision, transform, tessellation and validator version; unsupported/unknown required checks block qualified export.

Source: AD-8; R-3; G-3.

Source: `_bmad-output/planning-artifacts/epics.md`, line 615 in the captured input.

### NFR-11

**NFR-11: Honest print qualification.** Validation labels always identify the Target Print Profile, warnings, failures, unknowns, and last validation time; nova3D never presents validation as safety or universal manufacturability certification.

Source: `_bmad-output/planning-artifacts/epics.md`, line 563 in the captured input.

### UX-DR17

**UX-DR17: Print-validation and bounded recovery states.** Expose exact profile/transform, check support, last-checked time, pass/warning/fail/unknown and stale results. Required unknowns block export. Show each repair and affected geometry; one full regeneration/reconversion is lineage-bound, preserves originals and returns to inspection/approval/validation. Failure after the allowed attempt stops with an actionable explanation.

Source: FR-24–FR-28; R-3/R-11.

Source: `_bmad-output/planning-artifacts/epics.md`, line 843 in the captured input.

### UX-DR58

**UX-DR58: Target Print Profile (V-01).** Select printer, material, physical size; first fixture is Bambu Lab A1 mini, 0.4 mm nozzle, gold silk PLA, maximum 90 × 90 × 90 mm. R-3 refines this to the exact Bambu PLA Silk+ Gold profile closure and overrides in AR-11.

Required states/variants: Default fixture, changed profile, incomplete profile.

Source: SCREEN-INVENTORY V-01; canonical ux-contract; applicable ratified decisions.

Source: `_bmad-output/planning-artifacts/epics.md`, line 1081 in the captured input.

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
