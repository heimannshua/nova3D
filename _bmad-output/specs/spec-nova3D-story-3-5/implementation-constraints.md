# Implementation Constraints

Read the [project SPEC](../spec-nova3D/SPEC.md) and every companion it names recursively. Implement only this story's declared slice. Mapped requirements constrain the touched behavior; their other slices remain assigned to the other stories.

## Governing Interpretation

Ratified R-1–R-11 and approved SC-1–SC-7 override conflicting older PRD wording. Whole-plan approval and deterministic recipe equivalence apply to evidence_text/evidence_images. Direct image work uses confirmed ordered images/scope and acknowledged uncertainty, with honest inference provenance and restorable snapshots; it has no synthetic Research Plan or identical-reinference guarantee. Exact-model approval and required profile checks gate qualified export in every mode.

Prepared offline work follows the adopted no-lease/reconnect policy: learned disable locks until newer authoritative re-enable, learned tombstones purge before import, and network uncertainty alone is not deletion. R-11 permits one atomically consumed full fallback slot per lineage. The parent contract supplies every detailed authority, money, geometry, lifecycle and UX invariant.

## Mapped Requirements

### FR-12

#### FR-12: Whole-project review before generation

nova3D presents one complete Research Plan for the requested Model before any Canonical Model is generated.

**Consequences:**
- The review includes proposed choices, rejected or competing alternatives, citations, reasoning, Detail Status, and expected geometry effects.
- The review groups related Consequential Details into evidence packages for each model section while preserving one final whole-Project approval boundary.
- Apparently clear sections are not generated incrementally while other research remains unresolved.

Source: PRD §4, FR-12.

**Ratified application:** Whole-plan completeness and approval govern evidence_text and evidence_images. image_direct uses confirmed scope, ordered images and explicit uncertainty acknowledgment; it never fabricates a Research Plan.

Source: `_bmad-output/planning-artifacts/epics.md`, line 217 in the captured input.

### FR-13

#### FR-13: Version-bound plan approval

The user can approve or reject a specific Research Plan version.

**Consequences:**
- Geometry generation is blocked until Plan Approval exists.
- Plan Approval records the approver, time, selected and rejected options, and affected Consequential Details.
- A change to an approved Research Plan creates a new version and invalidates generation authority until that version is approved.

Source: PRD §4, FR-13.

**Ratified application:** Plan Approval gates only the two evidence modes. Direct conversion has its own immutable confirmed-input/uncertainty gate, followed by exact-model approval and validation for qualified export.

Source: `_bmad-output/planning-artifacts/epics.md`, line 230 in the captured input.

### AR-4

**AR-4: Explicit request modes.** Persist immutable evidence_text, evidence_images or image_direct revisions. Evidence modes need complete whole-plan approval of the exact digest. Direct mode needs confirmed scope, ordered image digests and acknowledged uncertainty, and never gains historical status. Changing modes creates a successor request. Every qualified export still requires exact-model approval and compatible validation.

Source: AD-3; R-8, R-11; scope-and-readiness.

Source: `_bmad-output/planning-artifacts/epics.md`, line 587 in the captured input.

### AR-5

**AR-5: Provenance and immutable publication.** Preserve SourceRevision → ClaimRevision → Detail/Option → PlanRevision/PlanApproval → Parameter → Feature → ModelVersion → ModelApproval/Validation → Export links, including reverse navigation, competing choices, actors and times. Stable logical features have version-specific geometry/claim bindings. Artifacts owns one canonical JSON manifest-root/digest family with immutable ID, ownership, size, kind, byte digest, canonical serialization version, producing activity and child references. Approval, gateway access, restore, cleanup and deletion resolve the same manifest roots; object keys cannot redefine them. Staged output becomes usable/restorable only through verified coordinated publication.

Source: AD-4, AD-13; shared artifact identity.

Source: `_bmad-output/planning-artifacts/epics.md`, line 591 in the captured input.

### AR-6

**AR-6: Complete and eligible research.** Use the Middot package's finite checklist for shape, dimensions, materials, placement, printability and interpretation; require an independent omission review with no unresolved gap. Middot chapter 3 governs spatial reconstruction; low-authority pages remain leads. Project exclusions and Account toggles target stable source identities, increment effective policy epochs and invalidate/recheck affected active conclusions. Pin the Account-policy revision, Project-exclusion revision and explicit source set in attempts, private cache-adoption records and plan digests. Filtering is deterministic for those inputs; active changes create a successor draft and rerun affected conclusions and completeness before approval. Approved records stay immutable.

Source: AD-5; evidence-policy identity.

Source: `_bmad-output/planning-artifacts/epics.md`, line 595 in the captured input.

### UX-DR16

**UX-DR16: Immutable approvals and comparison.** Show exact plan/model version and readiness before approval. Compare geometry, parameters, evidence/choices, personalization, approvals and validation; restoration preserves later history and does not silently authorize an export. Changed interpretations, substantive repair and personalization route to the relevant successor approval.

Source: FR-12/FR-13/FR-20–FR-23/FR-27.

Source: `_bmad-output/planning-artifacts/epics.md`, line 839 in the captured input.

### UX-DR44

**UX-DR44: Research Plan overview (R-01).** Whole-Project status and grouped evidence packages for model sections.

Required states/variants: Incomplete, ready for review, approved, rejected, invalidated by successor revision.

Source: SCREEN-INVENTORY R-01; canonical ux-contract; applicable ratified decisions.

Source: `_bmad-output/planning-artifacts/epics.md`, line 997 in the captured input.

### UX-DR48

**UX-DR48: Plan Approval (R-05).** Approve or reject the exact Research Plan version only when complete.

Required states/variants: Blocked/not ready, review complete, approval confirmation, rejected with reason, approval invalidated.

Source: SCREEN-INVENTORY R-05; canonical ux-contract; applicable ratified decisions.

Source: `_bmad-output/planning-artifacts/epics.md`, line 1021 in the captured input.

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
