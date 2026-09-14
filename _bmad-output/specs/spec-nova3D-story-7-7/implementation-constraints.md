# Implementation Constraints

Read the [project SPEC](../spec-nova3D/SPEC.md) and every companion it names recursively. Implement only this story's declared slice. Mapped requirements constrain the touched behavior; their other slices remain assigned to the other stories.

## Governing Interpretation

Ratified R-1–R-11 and approved SC-1–SC-7 override conflicting older PRD wording. Whole-plan approval and deterministic recipe equivalence apply to evidence_text/evidence_images. Direct image work uses confirmed ordered images/scope and acknowledged uncertainty, with honest inference provenance and restorable snapshots; it has no synthetic Research Plan or identical-reinference guarantee. Exact-model approval and required profile checks gate qualified export in every mode.

Prepared offline work follows the adopted no-lease/reconnect policy: learned disable locks until newer authoritative re-enable, learned tombstones purge before import, and network uncertainty alone is not deletion. R-11 permits one atomically consumed full fallback slot per lineage. The parent contract supplies every detailed authority, money, geometry, lifecycle and UX invariant.

## Mapped Requirements

### FR-7

#### FR-7: Actionable notifications

The app displays an app-wide Notification bar for Jobs and approval events.

**Consequences:**
- Notifications cover research readiness, generation completion or failure, Export readiness, and later printer events.
- Selecting a Notification opens the exact Project, approval item, failed Job, Export, or later printer event requiring attention.

Source: PRD §4, FR-7.

**Ratified application:** SC-5 adds first-version phone push for research, generation, validation and Export. Printing events remain inactive until later printer integration.

Source: `_bmad-output/planning-artifacts/epics.md`, line 157 in the captured input.

### AR-25

**AR-25: Notification delivery and privacy.** Commit one durable in-app notification per recipient/event; deduplicate unreliable realtime/push and refresh canonical state. Resolve exact targets with live authorization. Push carries opaque event references and generic category text, no private excerpts/model names/images. Persist per-category research/generation/validation/export preferences and contextual permission/install guidance; denial does not erase in-app history. Printing notifications remain inactive.

Source: AD-18; SC-5.

Source: `_bmad-output/planning-artifacts/epics.md`, line 681 in the captured input.

### SC-5

##### SC-5: Phone push notifications

The first version adds phone push notifications for research, generation, validation, Export, and later printing events. Account Settings controls categories. In-app event history remains available when phone alerts are disabled.

Printing notifications remain inactive/Coming later in this version.

Source: UX-SCOPE-CHANGES SC-5; canonical ux-contract; applicable ratified decisions.

Source: `_bmad-output/planning-artifacts/epics.md`, line 514 in the captured input.

### UX-DR18

**UX-DR18: Notifications and permissions.** Keep durable app-wide history and exact authorized deep links whether phone push is allowed, denied or off. Offer contextual install/permission guidance and independent research/generation/validation/export toggles; payload previews contain generic categories/opaque references only. Printing remains Coming later.

Source: SC-5; UX-6; AD-18.

Source: `_bmad-output/planning-artifacts/epics.md`, line 847 in the captured input.

### UX-DR65

**UX-DR65: Notification Settings (S-02).** Category-specific phone push controls while in-app history remains.

Required states/variants: Permission allowed/denied, all off, mixed categories.

Source: SCREEN-INVENTORY S-02; canonical ux-contract; applicable ratified decisions.

Source: `_bmad-output/planning-artifacts/epics.md`, line 1123 in the captured input.

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
