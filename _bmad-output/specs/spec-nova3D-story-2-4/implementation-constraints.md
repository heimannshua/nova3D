# Implementation Constraints

Read the [project SPEC](../spec-nova3D/SPEC.md) and every companion it names recursively. Implement only this story's declared slice. Mapped requirements constrain the touched behavior; their other slices remain assigned to the other stories.

## Governing Interpretation

Ratified R-1–R-11 and approved SC-1–SC-7 override conflicting older PRD wording. Whole-plan approval and deterministic recipe equivalence apply to evidence_text/evidence_images. Direct image work uses confirmed ordered images/scope and acknowledged uncertainty, with honest inference provenance and restorable snapshots; it has no synthetic Research Plan or identical-reinference guarantee. Exact-model approval and required profile checks gate qualified export in every mode.

Prepared offline work follows the adopted no-lease/reconnect policy: learned disable locks until newer authoritative re-enable, learned tombstones purge before import, and network uncertainty alone is not deletion. R-11 permits one atomically consumed full fallback slot per lineage. The parent contract supplies every detailed authority, money, geometry, lifecycle and UX invariant.

## Mapped Requirements

### FR-4

#### FR-4: Usage visibility and limits

The Administrator can view per-Account paid usage or spending and configure a Usage Limit.

**Consequences:**
- Reaching a Usage Limit blocks new paid Jobs with an explanation.
- Already-running Jobs are allowed to finish.
- The Administrator can raise or reset the Usage Limit.
- Before a paid Job starts, nova3D atomically reserves its maximum estimated cost against settled usage and all outstanding reservations.
- A Job cannot start when the available allowance cannot cover its reservation.
- Duplicate submissions cannot create duplicate reservations, Jobs, or charges.
- Completion or cancellation settles actual usage and releases unused reserved allowance.
- Paid permission applies by category across all Paid Work. Before the first paid operation in a category, nova3D identifies the category, provider, purpose, and declared maximum charge and obtains permission for that Project.
- Permission for one paid category does not authorize another category; every category remains subject to the Account's Usage Limit and atomic reservation rules.
- Before an outside provider receives Project data, nova3D identifies the provider, the minimum data categories to be sent, and known retention or deletion limitations.
- Outbound data is limited to content from the current Project that is necessary for the operation; credentials, unrelated Workspace content, and Personalization not approved for that operation are prohibited.

Source: PRD §4, FR-4.

Source: `_bmad-output/planning-artifacts/epics.md`, line 114 in the captured input.

### AR-16

**AR-16: Atomic money and paid permissions.** Paid categories independently disclose provider, purpose, outbound-data/retention categories and maximum, with Project permission off by default. Use one Usage-owned checked integer USD-microdollar/rational calculator: sum under immutable model/options/rates, apply billing increments, round upward once per operation, reject overflow/unknown rates/foreign currency/unsupported parameters. Atomically enforce Account-period allowance, $5 lifetime research-Job cap across attempts and $1 external-operation cap. Defaults are $25/invitee and $50/Administrator per UTC month. Preserve outstanding liabilities across resets; already-authorized work retains reservations while disable cancels it.

Source: AD-11; R-6; G-6.

Source: `_bmad-output/planning-artifacts/epics.md`, line 645 in the captured input.

### NFR-9

**NFR-9: Cost control.** Paid Work cannot begin without category-specific Project permission, a disclosed maximum charge, and an atomic cost reservation within the available Usage Limit. Usage records, reservations, settlements, and releases must reconcile with each idempotent Job. nova3D must present the resulting spending record clearly enough for Josh to understand and control spending.

Source: `_bmad-output/planning-artifacts/epics.md`, line 559 in the captured input.

### UX-DR71

**UX-DR71: Usage and limits (AD-03).** Per-Account paid usage, reservations, settlements, available allowance, set/reset limit.

Required states/variants: Under limit, nearly reached, reached, running Job allowed, new paid Job blocked.

Source: SCREEN-INVENTORY AD-03; canonical ux-contract; applicable ratified decisions.

Source: `_bmad-output/planning-artifacts/epics.md`, line 1159 in the captured input.

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
