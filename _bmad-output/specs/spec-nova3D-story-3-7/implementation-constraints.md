# Implementation Constraints

Read the [project SPEC](../spec-nova3D/SPEC.md) and every companion it names recursively. Implement only this story's declared slice. Mapped requirements constrain the touched behavior; their other slices remain assigned to the other stories.

## Governing Interpretation

Ratified R-1–R-11 and approved SC-1–SC-7 override conflicting older PRD wording. Whole-plan approval and deterministic recipe equivalence apply to evidence_text/evidence_images. Direct image work uses confirmed ordered images/scope and acknowledged uncertainty, with honest inference provenance and restorable snapshots; it has no synthetic Research Plan or identical-reinference guarantee. Exact-model approval and required profile checks gate qualified export in every mode.

Prepared offline work follows the adopted no-lease/reconnect policy: learned disable locks until newer authoritative re-enable, learned tombstones purge before import, and network uncertainty alone is not deletion. R-11 permits one atomically consumed full fallback slot per lineage. The parent contract supplies every detailed authority, money, geometry, lifecycle and UX invariant.

## Mapped Requirements

### FR-6

#### FR-6: Concurrent background jobs

An Account can use other Projects while multiple research or generation Jobs run independently.

**Consequences:**
- Each Job exposes waiting, running, completed, failed, and cancelled states.
- Project data and results cannot leak between concurrent Jobs.
- The user can cancel a Job without damaging previously approved data or Versions.
- Failed Jobs do not retry automatically; they preserve the last approved state, explain the known cause in beginner-friendly language, and wait for a user retry decision.

Source: PRD §4, FR-6.

Source: `_bmad-output/planning-artifacts/epics.md`, line 145 in the captured input.

### FR-7

#### FR-7: Actionable notifications

The app displays an app-wide Notification bar for Jobs and approval events.

**Consequences:**
- Notifications cover research readiness, generation completion or failure, Export readiness, and later printer events.
- Selecting a Notification opens the exact Project, approval item, failed Job, Export, or later printer event requiring attention.

Source: PRD §4, FR-7.

**Ratified application:** SC-5 adds first-version phone push for research, generation, validation and Export. Printing events remain inactive until later printer integration.

Source: `_bmad-output/planning-artifacts/epics.md`, line 157 in the captured input.

### FR-14

#### FR-14: Research mode and paid escalation

The user can choose per Project whether research may use paid services or must remain free-only.

**Consequences:**
- nova3D cannot start paid research without explicit user permission.
- Paid research is also subject to the Account's Usage Limit.
- If free-only research cannot resolve complete Consequential Detail coverage, nova3D shows the remaining gaps and asks whether to switch the Project to paid research.
- Declining paid escalation leaves the Project unready for Plan Approval while blocking gaps remain.
- Before research begins, the user separately chooses whether to reuse available cached research or research the subject again from scratch.
- Cached results show their original research date, immutable revision identity, and cached status; nova3D does not automatically re-verify them.
- A correction creates a new Cached Research Revision linked to its predecessor; it never changes an existing revision in place.
- An approved Project remains pinned to the revision it used. Adopting a successor revision creates a new Research Plan version and requires renewed Plan Approval before regeneration.
- Paid research also follows the Paid Work permission, disclosure, Usage Limit, and reservation rules in FR-4.

Source: PRD §4, FR-14.

Source: `_bmad-output/planning-artifacts/epics.md`, line 243 in the captured input.

### AR-14

**AR-14: Durable Jobs and bounded retries.** Accept Jobs only with committed dispatch outbox; persist Job → JobAttempt → StepExecution → ExternalOperation identities and receipts. Upstash orchestrates bounded HTTP steps and worker completions; Postgres owns state. Configure workflow, explicit queue publishes and provider SDKs for zero failed-work retries, verifying effective behavior with a deliberately failing research step. Duplicate transport returns existing receipts without repeated side effects; terminal failed/cancelled attempts cannot be reclaimed. Lease loss becomes interrupted failure; user retries create new linked attempts under the same Job and wait for prior potentially chargeable work to reconcile. Logical step keys are unique per attempt, and operation ordinals per step; Jobs owns receipts while Usage owns their ledger entries. Preserve last approved state and actionable failure details.

Source: AD-9; work/billing identity.

Source: `_bmad-output/planning-artifacts/epics.md`, line 637 in the captured input.

### AR-15

**AR-15: Fencing and authenticated service calls.** Each attempt binds input digest, Project revision, live Account authorization/evidence-policy epochs, lease and unique fencing token. Recheck before claim, each external step and publication. Cancel/disable/delete revoke commit authority before best-effort cancellation; stage output by attempt and clean it without publishing late results. Signed service requests bind environment, audience, Job/attempt, payload digest and nonce, expire within five minutes and allow at most 60 seconds skew. Verify native callback signatures and stored dispatch receipts; never infer callback identity from Project ID alone. Accept only the active signing key and one explicitly retiring key during the outstanding-request window; suspected compromise immediately revokes the key and affected leases. Reject replay mutations.

Source: AD-10; service authentication and delivery conventions.

Source: `_bmad-output/planning-artifacts/epics.md`, line 641 in the captured input.

### AR-17

**AR-17: Provider boundary and uncertain charges.** Adopt Anthropic Messages claude-sonnet-5 for evidence synthesis/vision and Brave Web Search v1 for discovery behind adapters, with version/rate/account-term verification before enablement. Search receives normalized public subjects only; vision receives only permissioned purpose-required data. No paid external 3D provider, Files/Batch/Managed Agents storage, private raw prompts in search, or billable free-credit fallback in free-only mode. Own hosting/storage/worker/local inference is instance overhead. Persist external identity before dispatch; uncertain charge retains full reservation until evidence, conservative maximum settlement or proven noncharge; corrections append ledger entries without replacement calls.

Source: R-6; AD-11; G-6.

Source: `_bmad-output/planning-artifacts/epics.md`, line 649 in the captured input.

### AR-25

**AR-25: Notification delivery and privacy.** Commit one durable in-app notification per recipient/event; deduplicate unreliable realtime/push and refresh canonical state. Resolve exact targets with live authorization. Push carries opaque event references and generic category text, no private excerpts/model names/images. Persist per-category research/generation/validation/export preferences and contextual permission/install guidance; denial does not erase in-app history. Printing notifications remain inactive.

Source: AD-18; SC-5.

Source: `_bmad-output/planning-artifacts/epics.md`, line 681 in the captured input.

### NFR-8

**NFR-8: Explainable failures.** User-facing failures identify the failed stage, known cause, preserved state, cost impact where known, and permitted next action in beginner-friendly language.

Source: `_bmad-output/planning-artifacts/epics.md`, line 557 in the captured input.

### NFR-9

**NFR-9: Cost control.** Paid Work cannot begin without category-specific Project permission, a disclosed maximum charge, and an atomic cost reservation within the available Usage Limit. Usage records, reservations, settlements, and releases must reconcile with each idempotent Job. nova3D must present the resulting spending record clearly enough for Josh to understand and control spending.

Source: `_bmad-output/planning-artifacts/epics.md`, line 559 in the captured input.

### NFR-10

**NFR-10: Responsive workspace.** Research, generation, validation, repair, and export run without blocking navigation or ordinary Project inspection. Browser preview degradation or failure cannot damage manufacturing geometry.

Source: `_bmad-output/planning-artifacts/epics.md`, line 561 in the captured input.

### UX-DR11

**UX-DR11: Recorded research activity and source reading.** Show actual acquisition/acceptance stages and source roles while Jobs run. Reading original text, translation, citation and evidence-based explanation does not pause the Job. Show unavailable excerpts/digest-only evidence honestly; never fabricate hidden model reasoning.

Source: UX-3; AD-18.

Source: `_bmad-output/planning-artifacts/epics.md`, line 819 in the captured input.

### UX-DR39

**UX-DR39: In Progress overview (J-01).** Active research, generation, validation, repair, and sync Jobs; **Prints in Progress — Coming later**.

Required states/variants: No Jobs, several concurrent Jobs, mixed states, future-print placeholder.

Source: SCREEN-INVENTORY J-01; canonical ux-contract; applicable ratified decisions.

Source: `_bmad-output/planning-artifacts/epics.md`, line 967 in the captured input.

### UX-DR40

**UX-DR40: Job detail (J-02).** Current stage, real progress, preserved state, cost impact when known, cancel action.

Required states/variants: Waiting, running, completed, failed, cancelled, stale result rejected.

Source: SCREEN-INVENTORY J-02; canonical ux-contract; applicable ratified decisions.

Source: `_bmad-output/planning-artifacts/epics.md`, line 973 in the captured input.

### UX-DR41

**UX-DR41: Live Source activity (J-03).** Actual Sources being examined and their role as lead or evidence; no fabricated hidden reasoning.

Required states/variants: Searching, Source opened, lead, accepted evidence, rejected, replacement search.

Source: SCREEN-INVENTORY J-03; canonical ux-contract; applicable ratified decisions.

Source: `_bmad-output/planning-artifacts/epics.md`, line 979 in the captured input.

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
