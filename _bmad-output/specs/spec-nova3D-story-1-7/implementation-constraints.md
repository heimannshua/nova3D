# Implementation Constraints

Read the [project SPEC](../spec-nova3D/SPEC.md) and every companion it names recursively. Implement only this story's declared slice. Mapped requirements constrain the touched behavior; their other slices remain assigned to the other stories.

## Governing Interpretation

Ratified R-1–R-11 and approved SC-1–SC-7 override conflicting older PRD wording. Whole-plan approval and deterministic recipe equivalence apply to evidence_text/evidence_images. Direct image work uses confirmed ordered images/scope and acknowledged uncertainty, with honest inference provenance and restorable snapshots; it has no synthetic Research Plan or identical-reinference guarantee. Exact-model approval and required profile checks gate qualified export in every mode.

Prepared offline work follows the adopted no-lease/reconnect policy: learned disable locks until newer authoritative re-enable, learned tombstones purge before import, and network uncertainty alone is not deletion. R-11 permits one atomically consumed full fallback slot per lineage. The parent contract supplies every detailed authority, money, geometry, lifecycle and UX invariant.

## Mapped Requirements

### FR-2

#### FR-2: Authentication and workspace isolation

An Account can authenticate and access only its own Workspace.

**Consequences:**
- Cross-Account access to Projects, Sources, decisions, Models, Versions, Jobs, Exports, and Notifications is denied.
- Administrative usage controls do not expose ordinary Project content.
- The Administrator cannot impersonate an Account, browse its private Workspace, or assign additional administrative privileges through the app.

Source: PRD §4, FR-2.

Source: `_bmad-output/planning-artifacts/epics.md`, line 85 in the captured input.

### FR-5

#### FR-5: Natural-language project intake

An Account can start a Project by describing the desired model in ordinary language without finding or uploading source texts.

**Consequences:**
- If the request permits materially different subjects, periods, scopes, or outcomes, nova3D asks clarifying questions before starting paid research.
- The user sees and confirms nova3D's understanding of the Project scope.

Source: PRD §4, FR-5.

**Ratified application:** SC-1 also requires ordered multi-view picture intake and the two explicit picture modes; natural-language intake does not defer them.

Source: `_bmad-output/planning-artifacts/epics.md`, line 133 in the captured input.

### AR-3

**AR-3: Transactional contracts.** Use auth-derived Account, UUID command/event/revision identities, expected revisions, SHA-256 content roots and UTC timestamps. Validate schema, ownership and idempotency; replay returns the original receipt and changed payload under the same ID is rejected. Commit business state, Job/reservation and outbox together. Sensitive tables deny browser DML; ownership-scoped foreign keys prevent cross-Workspace links. Redis, queues and client state cannot authorize transitions.

Source: AD-2; Consistency Conventions.

Source: `_bmad-output/planning-artifacts/epics.md`, line 583 in the captured input.

### NFR-1

**NFR-1: Workspace privacy.** Every user-facing and background operation enforces Account ownership. Cross-Account access to private Workspace data must produce no data disclosure.

Source: `_bmad-output/planning-artifacts/epics.md`, line 541 in the captured input.

### SC-3

##### SC-3: Complete phone workflow

The first version supports the complete workflow on desktop, laptop, and phone. Phone is not a reduced companion: creation, research review, 3D inspection, approvals, validation, and downloads must all work.

Source: UX-SCOPE-CHANGES SC-3; canonical ux-contract; applicable ratified decisions.

Source: `_bmad-output/planning-artifacts/epics.md`, line 502 in the captured input.

### UX-DR24

**UX-DR24: Global shell (G-01).** Access to Home, Notifications, Settings, Account, and contextual back navigation.

Required states/variants: Desktop/laptop, phone, LTR, RTL, light, dark.

Source: SCREEN-INVENTORY G-01; canonical ux-contract; applicable ratified decisions.

Source: `_bmad-output/planning-artifacts/epics.md`, line 877 in the captured input.

### UX-DR27

**UX-DR27: Home dashboard (H-01).** Three primary actions: **My Projects**, **Create**, **In Progress**.

Required states/variants: New Account/empty, active Jobs, unread Notification, desktop, phone.

Source: SCREEN-INVENTORY H-01; canonical ux-contract; applicable ratified decisions.

Source: `_bmad-output/planning-artifacts/epics.md`, line 895 in the captured input.

### UX-DR28

**UX-DR28: My Projects (H-02).** Model-focused collection of the Account's Projects.

Required states/variants: Empty, populated, search/filter if needed, locally saved, syncing, sync failed.

Source: SCREEN-INVENTORY H-02; canonical ux-contract; applicable ratified decisions.

Source: `_bmad-output/planning-artifacts/epics.md`, line 901 in the captured input.

### UX-DR29

**UX-DR29: Project/model overview (H-03).** Open a model, see current stage and Version, reach Sources and Project actions.

Required states/variants: Researching, awaiting Plan Approval, generating, awaiting Model Approval, validation failed, Export ready.

Source: SCREEN-INVENTORY H-03; canonical ux-contract; applicable ratified decisions.

Source: `_bmad-output/planning-artifacts/epics.md`, line 907 in the captured input.

### UX-DR30

**UX-DR30: Project actions (H-04).** Rename if supported, delete Project/Export, inspect history, resume next required action.

Required states/variants: Safe actions, destructive confirmation, tombstoned/cleanup state.

Source: SCREEN-INVENTORY H-04; canonical ux-contract; applicable ratified decisions.

Source: `_bmad-output/planning-artifacts/epics.md`, line 913 in the captured input.

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
