# Implementation Constraints

Read the [project SPEC](../spec-nova3D/SPEC.md) and every companion it names recursively. Implement only this story's declared slice. Mapped requirements constrain the touched behavior; their other slices remain assigned to the other stories.

## Governing Interpretation

Ratified R-1–R-11 and approved SC-1–SC-7 override conflicting older PRD wording. Whole-plan approval and deterministic recipe equivalence apply to evidence_text/evidence_images. Direct image work uses confirmed ordered images/scope and acknowledged uncertainty, with honest inference provenance and restorable snapshots; it has no synthetic Research Plan or identical-reinference guarantee. Exact-model approval and required profile checks gate qualified export in every mode.

Prepared offline work follows the adopted no-lease/reconnect policy: learned disable locks until newer authoritative re-enable, learned tombstones purge before import, and network uncertainty alone is not deletion. R-11 permits one atomically consumed full fallback slot per lineage. The parent contract supplies every detailed authority, money, geometry, lifecycle and UX invariant.

## Mapped Requirements

### FR-22

#### FR-22: Restorable version history

The user can view, compare, and restore prior Model Versions.

**Consequences:**
- Each Version preserves geometry, parameters, Research Plan, approvals, validations, Personalization, and generation metadata.
- Comparing two Versions shows changed geometry, parameters, Claims, interpretation decisions, Personalization, approvals, and validation results.
- Restoring a Version does not erase later history.
- A restored Version retains its original approval states; the user must grant any approval required for a new Export.

Source: PRD §4, FR-22.

**Ratified application:** Restore mode-appropriate provenance: exact plan/approvals for evidence models; exact inputs, activity, uncertainty and snapshots for direct models. A new qualified export still checks current exact-model approval and validation.

Source: `_bmad-output/planning-artifacts/epics.md`, line 345 in the captured input.

### AR-5

**AR-5: Provenance and immutable publication.** Preserve SourceRevision → ClaimRevision → Detail/Option → PlanRevision/PlanApproval → Parameter → Feature → ModelVersion → ModelApproval/Validation → Export links, including reverse navigation, competing choices, actors and times. Stable logical features have version-specific geometry/claim bindings. Artifacts owns one canonical JSON manifest-root/digest family with immutable ID, ownership, size, kind, byte digest, canonical serialization version, producing activity and child references. Approval, gateway access, restore, cleanup and deletion resolve the same manifest roots; object keys cannot redefine them. Staged output becomes usable/restorable only through verified coordinated publication.

Source: AD-4, AD-13; shared artifact identity.

Source: `_bmad-output/planning-artifacts/epics.md`, line 591 in the captured input.

### AR-9

**AR-9: Coordinate frames, measurement and versions.** Canonical content uses millimetres, right-handed coordinates and Z-up, retaining approved historical unit conversions. GLB explicitly converts to metres/Y-up; final-print scale/orientation is separately versioned. Every LOD preserves semantic feature IDs independently of triangles. Measurements use canonical geometry or labelled exact dimensions. Corrections rebuild dependency closure; restoration appends history and rechecks approval/profile validity without erasing successors.

Source: AD-7; FR-18–FR-22.

Source: `_bmad-output/planning-artifacts/epics.md`, line 607 in the captured input.

### AR-19

**AR-19: Revocable artifact transfer.** Keep buckets private and use ownership-scoped immutable keys and quota/lease-bounded upload staging. Verify checksums/content before attachment. Container gateway streams large uploads/downloads/ranges; authorize each range and every chunk of at most 1 MiB against live Account/session/Project/artifact state. Do not expose reusable signed download URLs or cache private responses/authorization; stop future chunks on revocation. Delivered or in-flight bytes cannot be recalled. Cleanup respects active leases.

Source: AD-13; file authorization.

Source: `_bmad-output/planning-artifacts/epics.md`, line 657 in the captured input.

### NFR-7

**NFR-7: Version durability.** Every Version presented as restorable must restore its geometry and provenance successfully. Deletion under FR-30 is the explicit exception.

Source: `_bmad-output/planning-artifacts/epics.md`, line 555 in the captured input.

### UX-DR16

**UX-DR16: Immutable approvals and comparison.** Show exact plan/model version and readiness before approval. Compare geometry, parameters, evidence/choices, personalization, approvals and validation; restoration preserves later history and does not silently authorize an export. Changed interpretations, substantive repair and personalization route to the relevant successor approval.

Source: FR-12/FR-13/FR-20–FR-23/FR-27.

Source: `_bmad-output/planning-artifacts/epics.md`, line 839 in the captured input.

### UX-DR56

**UX-DR56: Version restoration (M-08).** Restore a Version without silently authorizing a new Export.

Required states/variants: Confirmation, restored, approval required for new Export.

Source: SCREEN-INVENTORY M-08; canonical ux-contract; applicable ratified decisions.

Source: `_bmad-output/planning-artifacts/epics.md`, line 1069 in the captured input.

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
