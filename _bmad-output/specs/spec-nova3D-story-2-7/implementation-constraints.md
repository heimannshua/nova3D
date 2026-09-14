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

### AR-3

**AR-3: Transactional contracts.** Use auth-derived Account, UUID command/event/revision identities, expected revisions, SHA-256 content roots and UTC timestamps. Validate schema, ownership and idempotency; replay returns the original receipt and changed payload under the same ID is rejected. Commit business state, Job/reservation and outbox together. Sensitive tables deny browser DML; ownership-scoped foreign keys prevent cross-Workspace links. Redis, queues and client state cannot authorize transitions.

Source: AD-2; Consistency Conventions.

Source: `_bmad-output/planning-artifacts/epics.md`, line 583 in the captured input.

### AR-14

**AR-14: Durable Jobs and bounded retries.** Accept Jobs only with committed dispatch outbox; persist Job → JobAttempt → StepExecution → ExternalOperation identities and receipts. Upstash orchestrates bounded HTTP steps and worker completions; Postgres owns state. Configure workflow, explicit queue publishes and provider SDKs for zero failed-work retries, verifying effective behavior with a deliberately failing research step. Duplicate transport returns existing receipts without repeated side effects; terminal failed/cancelled attempts cannot be reclaimed. Lease loss becomes interrupted failure; user retries create new linked attempts under the same Job and wait for prior potentially chargeable work to reconcile. Logical step keys are unique per attempt, and operation ordinals per step; Jobs owns receipts while Usage owns their ledger entries. Preserve last approved state and actionable failure details.

Source: AD-9; work/billing identity.

Source: `_bmad-output/planning-artifacts/epics.md`, line 637 in the captured input.

### AR-15

**AR-15: Fencing and authenticated service calls.** Each attempt binds input digest, Project revision, live Account authorization/evidence-policy epochs, lease and unique fencing token. Recheck before claim, each external step and publication. Cancel/disable/delete revoke commit authority before best-effort cancellation; stage output by attempt and clean it without publishing late results. Signed service requests bind environment, audience, Job/attempt, payload digest and nonce, expire within five minutes and allow at most 60 seconds skew. Verify native callback signatures and stored dispatch receipts; never infer callback identity from Project ID alone. Accept only the active signing key and one explicitly retiring key during the outstanding-request window; suspected compromise immediately revokes the key and affected leases. Reject replay mutations.

Source: AD-10; service authentication and delivery conventions.

Source: `_bmad-output/planning-artifacts/epics.md`, line 641 in the captured input.

### AR-26

**AR-26: Deployment and operations.** Separate local/staging/production Supabase, queues, storage, secrets and callback origins in one repo; previews use synthetic data and disabled paid adapters. Verify immutable environment IDs at CI/startup/dispatch; prevent preview/production mixing. Adopt Vercel iad1, Supabase us-east-1, Railway Virginia us-east4-eqdc4a and nearest available Upstash with actual paid plans/topology recorded before acceptance. Pin command/result schemas, generator versions and worker images at Job acceptance; an unavailable compatible worker leaves the Job waiting with a reason. Declare and validate additive compatibility; major changes use separate workers/endpoints. Deploy consumers before producers, retain old consumers until their Jobs terminate, and retain generator images/locks needed by non-deleted reproducible Versions. Use expand/migrate/contract with rollback preserving money/provenance/deletion. Monitor outbox age, leases, failures, unknown costs, storage integrity and purge deadlines with redacted IDs; outages fail authorization closed.

Source: AD-19; R-9; G-9.

Source: `_bmad-output/planning-artifacts/epics.md`, line 685 in the captured input.

### NFR-4

**NFR-4: Durable job state.** Closing the browser, navigating to another Project, or a worker restart cannot lose an accepted Job, corrupt its Project, or misreport its final state.

Source: `_bmad-output/planning-artifacts/epics.md`, line 547 in the captured input.

### NFR-5

**NFR-5: Safe concurrency.** Concurrent Jobs remain isolated and cannot overwrite newer approved Project state. Results generated from stale inputs cannot silently become current.

Source: `_bmad-output/planning-artifacts/epics.md`, line 549 in the captured input.

### NFR-8

**NFR-8: Explainable failures.** User-facing failures identify the failed stage, known cause, preserved state, cost impact where known, and permitted next action in beginner-friendly language.

Source: `_bmad-output/planning-artifacts/epics.md`, line 557 in the captured input.

### NFR-10

**NFR-10: Responsive workspace.** Research, generation, validation, repair, and export run without blocking navigation or ordinary Project inspection. Browser preview degradation or failure cannot damage manufacturing geometry.

Source: `_bmad-output/planning-artifacts/epics.md`, line 561 in the captured input.

### UX-DR19

**UX-DR19: Failure and destructive-action clarity.** For failures show stage, known cause, preserved state, known cost impact and permitted next action, with no automatic retry implied. Sensitive/deletion/instance-closure flows show required fresh authentication, exact consequences and explicit confirmation; immediate hidden/tombstoned state remains distinct from cleanup completion.

Source: NFR-8; FR-3/FR-6/FR-30; screen inventory.

Source: `_bmad-output/planning-artifacts/epics.md`, line 851 in the captured input.

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
