# Implementation Constraints

Read the [project SPEC](../spec-nova3D/SPEC.md) and every companion it names recursively. Implement only this story's declared slice. Mapped requirements constrain the touched behavior; their other slices remain assigned to the other stories.

## Governing Interpretation

Ratified R-1–R-11 and approved SC-1–SC-7 override conflicting older PRD wording. Whole-plan approval and deterministic recipe equivalence apply to evidence_text/evidence_images. Direct image work uses confirmed ordered images/scope and acknowledged uncertainty, with honest inference provenance and restorable snapshots; it has no synthetic Research Plan or identical-reinference guarantee. Exact-model approval and required profile checks gate qualified export in every mode.

Prepared offline work follows the adopted no-lease/reconnect policy: learned disable locks until newer authoritative re-enable, learned tombstones purge before import, and network uncertainty alone is not deletion. R-11 permits one atomically consumed full fallback slot per lineage. The parent contract supplies every detailed authority, money, geometry, lifecycle and UX invariant.

## Mapped Requirements

### AR-28

**AR-28: Shared interface preferences and semantics.** Use configured locale catalogs, logical layout directions and isolated mixed-language evidence spans; preserve original source, translation and explanation separately. Choose supported device locale initially and persist Account language/theme/detail overrides. Light default, explicit dark and reduced-motion/accessible semantic controls apply to the full phone/computer workflow. Technical explanations change depth only, not decisions or evidence. Complete visual/token/state work under R-10 without treating historical empty UX spines as approved mockups.

Source: AD-17; R-10; canonical UX contract.

Source: `_bmad-output/planning-artifacts/epics.md`, line 693 in the captured input.

### SC-3

##### SC-3: Complete phone workflow

The first version supports the complete workflow on desktop, laptop, and phone. Phone is not a reduced companion: creation, research review, 3D inspection, approvals, validation, and downloads must all work.

Source: UX-SCOPE-CHANGES SC-3; canonical ux-contract; applicable ratified decisions.

Source: `_bmad-output/planning-artifacts/epics.md`, line 502 in the captured input.

### SC-4

##### SC-4: Internationalized interface

The interface supports any configured language, including full right-to-left layout. It initially follows the device language and can be changed in Account Settings. Original Source language, translation, and explanation remain distinguishable; Hebrew and English can appear together in evidence views.

Source: UX-SCOPE-CHANGES SC-4; canonical ux-contract; applicable ratified decisions.

Source: `_bmad-output/planning-artifacts/epics.md`, line 508 in the captured input.

### SC-7

##### SC-7: First-version accessibility and preferences

The first version targets WCAG 2.2 AA and supports keyboard operation, screen readers, visible focus, text enlargement, high contrast, non-colour state cues, and reduced motion. Light mode is the default; dark mode is a manual option. Explanations use ordinary language by default, with a Settings option for more technical detail.

R-10 adopts the light neutral/slate/indigo baseline and delegates detailed responsive design without another direction-selection checkpoint or a mandatory external design tool.

Source: UX-SCOPE-CHANGES SC-7; canonical ux-contract; applicable ratified decisions.

Source: `_bmad-output/planning-artifacts/epics.md`, line 531 in the captured input.

### UX-DR1

**UX-DR1: Implement the ratified light/dark token system.** Define semantic tokens for neutral surfaces, slate text, indigo actions, evidence/status colors, typography, spacing, radii, elevation and component states. Apply consistent tokens to approvals, jobs, notifications, image-quality warnings, source exclusions, sync, validation, destructive actions and 3D selection. Preserve contrast in both themes; light is default. Specific values/components are delegated design work, not already-approved outputs.

Source: R-10; UX-7; design handoff.

Source: `_bmad-output/planning-artifacts/epics.md`, line 779 in the captured input.

### UX-DR2

**UX-DR2: Complete responsive workflow.** Every required surface has usable phone and desktop/laptop treatment. Desktop centers the model and evidence inspector; phones use stacked panels/drawers preserving every creation, review, inspection, approval, validation and download control. Maintain secondary global navigation without replacing My Projects, Create and In Progress.

Source: SC-3; UX-1/UX-5/UX-7.

Source: `_bmad-output/planning-artifacts/epics.md`, line 783 in the captured input.

### UX-DR3

**UX-DR3: Keyboard and screen-reader inspection.** Expose labelled semantic feature lists and evidence/inspection actions beyond canvas. Support complete keyboard navigation, visible focus, accessible names and dynamic-state announcements; touch alternatives cannot depend on hover, right-click or precision pointing.

Source: SC-7; UX-5; AD-17.

Source: `_bmad-output/planning-artifacts/epics.md`, line 787 in the captured input.

### UX-DR4

**UX-DR4: Accessible layout and state cues.** Verify WCAG 2.2 AA contrast, text enlargement/reflow, usable touch targets, non-colour status distinctions and reduced motion across every relevant surface. Use text/shape plus color for evidence, approvals, failures and warnings; do not remove functionality in accessibility modes.

Source: SC-7; UX-5; design handoff.

Source: `_bmad-output/planning-artifacts/epics.md`, line 791 in the captured input.

### UX-DR5

**UX-DR5: Configured localization and full RTL.** Initial locale matches a supported device language; an Account override persists. Use logical directions and support text expansion without clipping or semantic reversal; isolate mixed-direction IDs, units, extensions and citations. Keep original-language evidence, translation and explanation distinct and show Hebrew/English together correctly.

Source: SC-4; UX-3/UX-5; AD-17.

Source: `_bmad-output/planning-artifacts/epics.md`, line 795 in the captured input.

### UX-DR6

**UX-DR6: Honest language and guidance.** Use concise ordinary language and real nova3D terms; technical-detail preference changes explanation depth only. First-use guidance is dismissible and reopenable. Never fabricate passages/citations/dimensions/scholars or claim historical certainty, universal printability or safety certification; unverified design sample content is explicitly labelled.

Source: UX-1/UX-5; design handoff.

Source: `_bmad-output/planning-artifacts/epics.md`, line 799 in the captured input.

### UX-DR7

**UX-DR7: Explicit workflow and evidence distinctions.** Keep sourced, inferred, disputed, unknown and user-added distinct; internal user_added maps to the display label user-added. Distinguish lead/evidence, cached/fresh dates, reconstruction/personalization, direct/evidence modes, Plan/Model Approval, preview/manufacturing geometry, warning/failure/unknown, Project source exclusion/Account disabling, and every Job/local-sync state.

Source: Screen inventory cross-surface states; UX-3; AD-3/AD-4.

Source: `_bmad-output/planning-artifacts/epics.md`, line 803 in the captured input.

### UX-DR20

**UX-DR20: Traceable responsive design coverage.** Complete and verify every screen/state below under R-10, with desktop/phone, light/dark, a complete RTL journey, bilingual evidence, focus/names/announcements, enlarged text, contrast and reduced-motion coverage. Maintain a screen-to-implemented-design/state mapping when surfaces combine. DESIGN.md/EXPERIENCE.md are metadata-only historical drafts; neither a new direction-selection checkpoint nor a specific external design tool is required.

Source: R-10; UX-7; screen inventory/design handoff.

Source: `_bmad-output/planning-artifacts/epics.md`, line 855 in the captured input.

### UX-DR24

**UX-DR24: Global shell (G-01).** Access to Home, Notifications, Settings, Account, and contextual back navigation.

Required states/variants: Desktop/laptop, phone, LTR, RTL, light, dark.

Source: SCREEN-INVENTORY G-01; canonical ux-contract; applicable ratified decisions.

Source: `_bmad-output/planning-artifacts/epics.md`, line 877 in the captured input.

### UX-DR26

**UX-DR26: First-use guidance (G-03).** Explain each workflow stage in ordinary language; dismiss and reopen later.

Required states/variants: First use, dismissed, reopened from Settings.

Source: SCREEN-INVENTORY G-03; canonical ux-contract; applicable ratified decisions.

Source: `_bmad-output/planning-artifacts/epics.md`, line 889 in the captured input.

### UX-DR64

**UX-DR64: Account Settings (S-01).** Language, light/dark choice, simple/technical explanation level, onboarding replay.

Required states/variants: Device-language default, manual override, RTL preview, light default/dark selected.

Source: SCREEN-INVENTORY S-01; canonical ux-contract; applicable ratified decisions.

Source: `_bmad-output/planning-artifacts/epics.md`, line 1117 in the captured input.

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
