# Implementation Constraints

Read the [project SPEC](../spec-nova3D/SPEC.md) and every companion it names recursively. Implement only this story's declared slice. Mapped requirements constrain the touched behavior; their other slices remain assigned to the other stories.

## Governing Interpretation

Ratified R-1–R-11 and approved SC-1–SC-7 override conflicting older PRD wording. Whole-plan approval and deterministic recipe equivalence apply to evidence_text/evidence_images. Direct image work uses confirmed ordered images/scope and acknowledged uncertainty, with honest inference provenance and restorable snapshots; it has no synthetic Research Plan or identical-reinference guarantee. Exact-model approval and required profile checks gate qualified export in every mode.

Prepared offline work follows the adopted no-lease/reconnect policy: learned disable locks until newer authoritative re-enable, learned tombstones purge before import, and network uncertainty alone is not deletion. R-11 permits one atomically consumed full fallback slot per lineage. The parent contract supplies every detailed authority, money, geometry, lifecycle and UX invariant.

## Mapped Requirements

### FR-9

#### FR-9: Source authority policy

nova3D distinguishes research leads from evidence used in recommendations.

**Consequences:**
- Low-authority pages may be used as leads only.
- Recommendations identify and cite primary texts, recognized commentaries, books, archaeological evidence, or work by named scholars.
- Sources retain identity and enough location context for the user to inspect the support for a Claim.
- Changed Source content creates a successor Source and Cached Research Revision; it cannot silently alter an existing Claim or approved Research Plan.
- Only Claims and provenance reproducible from identified non-private Sources qualify for admission to shared cached research.

Source: PRD §4, FR-9.

Source: `_bmad-output/planning-artifacts/epics.md`, line 180 in the captured input.

### FR-11

#### FR-11: Explainable conclusions and options

For each uncertain Consequential Detail, nova3D presents its recommendation and Defensible Options with transparent reasoning.

**Consequences:**
- The user can inspect supporting Sources, conflicting evidence, the reasoning chain, and expected geometry effects.
- Confidence is explained through evidence and reasoning rather than only an opaque score.
- If evidence cannot settle the detail, the user must choose an option.

Source: PRD §4, FR-11.

Source: `_bmad-output/planning-artifacts/epics.md`, line 206 in the captured input.

### AR-5

**AR-5: Provenance and immutable publication.** Preserve SourceRevision → ClaimRevision → Detail/Option → PlanRevision/PlanApproval → Parameter → Feature → ModelVersion → ModelApproval/Validation → Export links, including reverse navigation, competing choices, actors and times. Stable logical features have version-specific geometry/claim bindings. Artifacts owns one canonical JSON manifest-root/digest family with immutable ID, ownership, size, kind, byte digest, canonical serialization version, producing activity and child references. Approval, gateway access, restore, cleanup and deletion resolve the same manifest roots; object keys cannot redefine them. Staged output becomes usable/restorable only through verified coordinated publication.

Source: AD-4, AD-13; shared artifact identity.

Source: `_bmad-output/planning-artifacts/epics.md`, line 591 in the captured input.

### UX-DR5

**UX-DR5: Configured localization and full RTL.** Initial locale matches a supported device language; an Account override persists. Use logical directions and support text expansion without clipping or semantic reversal; isolate mixed-direction IDs, units, extensions and citations. Keep original-language evidence, translation and explanation distinct and show Hebrew/English together correctly.

Source: SC-4; UX-3/UX-5; AD-17.

Source: `_bmad-output/planning-artifacts/epics.md`, line 795 in the captured input.

### UX-DR6

**UX-DR6: Honest language and guidance.** Use concise ordinary language and real nova3D terms; technical-detail preference changes explanation depth only. First-use guidance is dismissible and reopenable. Never fabricate passages/citations/dimensions/scholars or claim historical certainty, universal printability or safety certification; unverified design sample content is explicitly labelled.

Source: UX-1/UX-5; design handoff.

Source: `_bmad-output/planning-artifacts/epics.md`, line 799 in the captured input.

### UX-DR11

**UX-DR11: Recorded research activity and source reading.** Show actual acquisition/acceptance stages and source roles while Jobs run. Reading original text, translation, citation and evidence-based explanation does not pause the Job. Show unavailable excerpts/digest-only evidence honestly; never fabricate hidden model reasoning.

Source: UX-3; AD-18.

Source: `_bmad-output/planning-artifacts/epics.md`, line 819 in the captured input.

### UX-DR42

**UX-DR42: Source reader during Job (J-04).** Read original text, translation, citation, and explanation without pausing research.

Required states/variants: Hebrew/English, RTL/LTR, excerpt unavailable/digest only, loading/failure.

Source: SCREEN-INVENTORY J-04; canonical ux-contract; applicable ratified decisions.

Source: `_bmad-output/planning-artifacts/epics.md`, line 985 in the captured input.

### UX-DR46

**UX-DR46: Consequential Detail review (R-03).** Claim, exact Source, reasoning, Detail Status, expected geometry effect.

Required states/variants: `sourced`, `inferred`, `disputed`, `unknown`, `user-added`.

Source: SCREEN-INVENTORY R-03; canonical ux-contract; applicable ratified decisions.

Source: `_bmad-output/planning-artifacts/epics.md`, line 1009 in the captured input.

### UX-DR47

**UX-DR47: Defensible Options (R-04).** Recommended option, competing evidence, geometry effects, user's choice.

Required states/variants: Recommendation, no settled recommendation, required choice, rejected option.

Source: SCREEN-INVENTORY R-04; canonical ux-contract; applicable ratified decisions.

Source: `_bmad-output/planning-artifacts/epics.md`, line 1015 in the captured input.

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
