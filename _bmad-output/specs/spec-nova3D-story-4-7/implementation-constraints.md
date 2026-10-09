# Implementation Constraints

Read the [project SPEC](../spec-nova3D/SPEC.md) and every companion it names recursively. Implement only this story's declared slice. Mapped requirements constrain the touched behavior; their other slices remain assigned to the other stories.

## Governing Interpretation

Ratified R-1–R-12 and approved SC-1–SC-7 override conflicting older PRD wording. Whole-plan approval and deterministic recipe equivalence apply to evidence_text/evidence_images. Direct image work uses confirmed ordered images/scope and acknowledged uncertainty, with honest inference provenance and restorable snapshots; it has no synthetic Research Plan or identical-reinference guarantee. Exact-model approval and required profile checks gate qualified export in every mode.

Prepared offline work follows the adopted no-lease/reconnect policy: learned disable locks until newer authoritative re-enable, learned tombstones purge before import, and network uncertainty alone is not deletion. R-11 permits one atomically consumed full fallback slot per lineage. The parent contract supplies every detailed authority, money, geometry, lifecycle and UX invariant.

## Mapped Requirements

### FR-18

#### FR-18: Read-only model inspection

The user can inspect a Model Version without manual geometry editing.

**Consequences:**
- Inspection supports rotating, panning, zooming, fitting or resetting the view, selecting standard or section views, hiding or isolating features, and measuring dimensions.
- Preview geometry is identified as a viewing representation and is not presented as proof of printability.

Source: PRD §4, FR-18.

Source: `_bmad-output/planning-artifacts/epics.md`, line 298 in the captured input.

### AR-9

**AR-9: Coordinate frames, measurement and versions.** Canonical content uses millimetres, right-handed coordinates and Z-up, retaining approved historical unit conversions. GLB explicitly converts to metres/Y-up; final-print scale/orientation is separately versioned. Every LOD preserves semantic feature IDs independently of triangles. Measurements use canonical geometry or labelled exact dimensions. Corrections rebuild dependency closure; restoration appends history and rechecks approval/profile validity without erasing successors.

Source: AD-7; FR-18–FR-22.

Source: `_bmad-output/planning-artifacts/epics.md`, line 640 in the captured input.

### AR-24

**AR-24: Viewer and device acceptance.** Qualify current/previous stable Chrome/Edge/Firefox, macOS/iOS Safari and Android Chrome on MacBook Air M2 16 GB, Windows 11 i5-1235U/Iris Xe 16 GB, iPhone 16 Pro and Pixel 9 Pro; freeze actual OS/browser builds. First-release scope (Josh, 2026-10-08): the Windows 11 class must pass; the other device classes are listed as not qualified until real-device evidence exists. Maximum preview fixture 100,000 triangles; ≤5 MB coarse first view and ≤20 MB full initial GLB. Cold model open-to-interactive ≤5 s at shaped 20 Mbps includes code, network, decode and working orbit/feature-evidence navigation; p95 frame time ≤33 ms after load. LOD swaps retain semantic selection/provenance. GPU loss keeps canonical data and semantic/static fallbacks without claiming a passed 3D benchmark.

Source: AD-7, AD-17; R-5; G-5.

Source: `_bmad-output/planning-artifacts/epics.md`, line 710 in the captured input.

### NFR-10

**NFR-10: Responsive workspace.** Research, generation, validation, repair, and export run without blocking navigation or ordinary Project inspection. Browser preview degradation or failure cannot damage manufacturing geometry.

Source: `_bmad-output/planning-artifacts/epics.md`, line 594 in the captured input.

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
