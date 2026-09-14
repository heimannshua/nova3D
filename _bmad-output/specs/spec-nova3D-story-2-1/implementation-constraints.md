# Implementation Constraints

Read the [project SPEC](../spec-nova3D/SPEC.md) and every companion it names recursively. Implement only this story's declared slice. Mapped requirements constrain the touched behavior; their other slices remain assigned to the other stories.

## Governing Interpretation

Ratified R-1–R-11 and approved SC-1–SC-7 override conflicting older PRD wording. Whole-plan approval and deterministic recipe equivalence apply to evidence_text/evidence_images. Direct image work uses confirmed ordered images/scope and acknowledged uncertainty, with honest inference provenance and restorable snapshots; it has no synthetic Research Plan or identical-reinference guarantee. Exact-model approval and required profile checks gate qualified export in every mode.

Prepared offline work follows the adopted no-lease/reconnect policy: learned disable locks until newer authoritative re-enable, learned tombstones purge before import, and network uncertainty alone is not deletion. R-11 permits one atomically consumed full fallback slot per lineage. The parent contract supplies every detailed authority, money, geometry, lifecycle and UX invariant.

## Mapped Requirements

### FR-5

#### FR-5: Natural-language project intake

An Account can start a Project by describing the desired model in ordinary language without finding or uploading source texts.

**Consequences:**
- If the request permits materially different subjects, periods, scopes, or outcomes, nova3D asks clarifying questions before starting paid research.
- The user sees and confirms nova3D's understanding of the Project scope.

Source: PRD §4, FR-5.

**Ratified application:** SC-1 also requires ordered multi-view picture intake and the two explicit picture modes; natural-language intake does not defer them.

Source: `_bmad-output/planning-artifacts/epics.md`, line 133 in the captured input.

### FR-17

#### FR-17: Plain-language personalization

The user can include or change Personalization through ordinary language, such as adding a name.

**Consequences:**
- Personalization is generated automatically without manual mesh editing.
- Every personalized Model Feature is visibly classified as user-added and cannot inherit evidence-backed status.
- Personalization must participate in inspection, versioning, Model Approval, and print validation.

Source: PRD §4, FR-17.

Source: `_bmad-output/planning-artifacts/epics.md`, line 286 in the captured input.

### AR-4

**AR-4: Explicit request modes.** Persist immutable evidence_text, evidence_images or image_direct revisions. Evidence modes need complete whole-plan approval of the exact digest. Direct mode needs confirmed scope, ordered image digests and acknowledged uncertainty, and never gains historical status. Changing modes creates a successor request. Every qualified export still requires exact-model approval and compatible validation.

Source: AD-3; R-8, R-11; scope-and-readiness.

Source: `_bmad-output/planning-artifacts/epics.md`, line 587 in the captured input.

### SC-1

##### SC-1: Picture workflows move into the first version

The PRD deferred picture workflows. The first version now includes both:

- **Direct picture-to-model:** labelled image-derived and not historically verified.
- **Research-assisted picture reconstruction:** identifies the subject, researches it, builds a complete Research Plan, and follows Plan Approval before evidence-backed generation.

Picture intake supports existing images, phone camera capture, and multiple images of one subject from different angles. Before conversion, nova3D checks clarity and angle coverage and recommends additional views. The user may choose **Generate anyway** after an explicit warning that incomplete views can cause invented or inaccurate geometry.

Source: UX-SCOPE-CHANGES SC-1; canonical ux-contract; applicable ratified decisions.

Source: `_bmad-output/planning-artifacts/epics.md`, line 483 in the captured input.

### UX-DR8

**UX-DR8: Intake sequence and paid consent.** Confirm subject, scope, outcome, picture mode and personalization after text/image intake. For research, separately select free/paid and cache/fresh afterward, before dispatch. Present provider/category/purpose, outbound-data/retention and maximum before paid permission. Scope confirmation, start confirmation, Plan Approval and Model Approval remain distinct.

Source: UX-2; FR-4/FR-5/FR-14.

Source: `_bmad-output/planning-artifacts/epics.md`, line 807 in the captured input.

### UX-DR31

**UX-DR31: Create entry (C-01).** Two equal first-version choices: **Enter text** and **Upload picture**.

Required states/variants: Desktop, phone, offline availability indication.

Source: SCREEN-INVENTORY C-01; canonical ux-contract; applicable ratified decisions.

Source: `_bmad-output/planning-artifacts/epics.md`, line 919 in the captured input.

### UX-DR32

**UX-DR32: Text request (C-02).** Ordinary-language model description plus optional Personalization.

Required states/variants: Empty, writing, validation problem, example/help without pre-filling intent.

Source: SCREEN-INVENTORY C-02; canonical ux-contract; applicable ratified decisions.

Source: `_bmad-output/planning-artifacts/epics.md`, line 925 in the captured input.

### UX-DR36

**UX-DR36: Understood request (C-06).** Show subject, scope, intended outcome, picture mode, and Personalization; wait for confirmation.

Required states/variants: Clear, ambiguous with clarification questions, edit request, confirmed.

Source: SCREEN-INVENTORY C-06; canonical ux-contract; applicable ratified decisions.

Source: `_bmad-output/planning-artifacts/epics.md`, line 949 in the captured input.

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
