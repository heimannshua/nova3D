# Implementation Constraints

Read the [project SPEC](../spec-nova3D/SPEC.md) and every companion it names recursively. Implement only this story's declared slice. Mapped requirements constrain the touched behavior; their other slices remain assigned to the other stories.

## Governing Interpretation

Ratified R-1–R-11 and approved SC-1–SC-7 override conflicting older PRD wording. Whole-plan approval and deterministic recipe equivalence apply to evidence_text/evidence_images. Direct image work uses confirmed ordered images/scope and acknowledged uncertainty, with honest inference provenance and restorable snapshots; it has no synthetic Research Plan or identical-reinference guarantee. Exact-model approval and required profile checks gate qualified export in every mode.

Prepared offline work follows the adopted no-lease/reconnect policy: learned disable locks until newer authoritative re-enable, learned tombstones purge before import, and network uncertainty alone is not deletion. R-11 permits one atomically consumed full fallback slot per lineage. The parent contract supplies every detailed authority, money, geometry, lifecycle and UX invariant.

## Mapped Requirements

### AR-7

**AR-7: Untrusted acquisition and output.** Restrict acquisition destinations/redirects, sizes and content types; block private-network and credential access. Source text, uploads and provider output are untrusted. Schema-validate output and verify citations before evidence acceptance. Never treat embedded instructions, prompts or proposed executable code as authority.

Source: AD-1, AD-5.

Source: `_bmad-output/planning-artifacts/epics.md`, line 599 in the captured input.

### AR-19

**AR-19: Revocable artifact transfer.** Keep buckets private and use ownership-scoped immutable keys and quota/lease-bounded upload staging. Verify checksums/content before attachment. Container gateway streams large uploads/downloads/ranges; authorize each range and every chunk of at most 1 MiB against live Account/session/Project/artifact state. Do not expose reusable signed download URLs or cache private responses/authorization; stop future chunks on revocation. Delivered or in-flight bytes cannot be recalled. Cleanup respects active leases.

Source: AD-13; file authorization.

Source: `_bmad-output/planning-artifacts/epics.md`, line 657 in the captured input.

### NFR-1

**NFR-1: Workspace privacy.** Every user-facing and background operation enforces Account ownership. Cross-Account access to private Workspace data must produce no data disclosure.

Source: `_bmad-output/planning-artifacts/epics.md`, line 541 in the captured input.

### NFR-2

**NFR-2: Secret protection.** Login, Invitation Code, recovery, provider, database, queue, signing, and callback-verification secrets are never stored or logged in readable form or exposed through browsers, URLs, prompts, Jobs, Notifications, Source Records, or Exports. Sensitive authentication actions require secure transport and protected sessions. Secrets support redaction, rotation, and revocation.

Source: `_bmad-output/planning-artifacts/epics.md`, line 543 in the captured input.

### SC-1

##### SC-1: Picture workflows move into the first version

The PRD deferred picture workflows. The first version now includes both:

- **Direct picture-to-model:** labelled image-derived and not historically verified.
- **Research-assisted picture reconstruction:** identifies the subject, researches it, builds a complete Research Plan, and follows Plan Approval before evidence-backed generation.

Picture intake supports existing images, phone camera capture, and multiple images of one subject from different angles. Before conversion, nova3D checks clarity and angle coverage and recommends additional views. The user may choose **Generate anyway** after an explicit warning that incomplete views can cause invented or inaccurate geometry.

Source: UX-SCOPE-CHANGES SC-1; canonical ux-contract; applicable ratified decisions.

Source: `_bmad-output/planning-artifacts/epics.md`, line 483 in the captured input.

### SC-3

##### SC-3: Complete phone workflow

The first version supports the complete workflow on desktop, laptop, and phone. Phone is not a reduced companion: creation, research review, 3D inspection, approvals, validation, and downloads must all work.

Source: UX-SCOPE-CHANGES SC-3; canonical ux-contract; applicable ratified decisions.

Source: `_bmad-output/planning-artifacts/epics.md`, line 502 in the captured input.

### UX-DR9

**UX-DR9: Ordered multi-view image intake.** Support file selection and a phone Take photo action, requesting camera permission only after that action. Preview, add, replace, reorder and remove angles of one subject within one request; handle denied camera access and bad files. Choose direct image-derived versus online research-assisted reconstruction explicitly.

Source: SC-1; UX-2.

Source: `_bmad-output/planning-artifacts/epics.md`, line 811 in the captured input.

### UX-DR33

**UX-DR33: Picture intake (C-03).** Choose existing image; on phone, take a photo; add several angles.

Required states/variants: Permission prompt, permission denied, image previews, replace/reorder/remove, file error.

Source: SCREEN-INVENTORY C-03; canonical ux-contract; applicable ratified decisions.

Source: `_bmad-output/planning-artifacts/epics.md`, line 931 in the captured input.

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
