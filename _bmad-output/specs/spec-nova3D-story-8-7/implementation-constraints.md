# Implementation Constraints

Read the [project SPEC](../spec-nova3D/SPEC.md) and every companion it names recursively. Implement only this story's declared slice. Mapped requirements constrain the touched behavior; their other slices remain assigned to the other stories.

## Governing Interpretation

Ratified R-1–R-11 and approved SC-1–SC-7 override conflicting older PRD wording. Whole-plan approval and deterministic recipe equivalence apply to evidence_text/evidence_images. Direct image work uses confirmed ordered images/scope and acknowledged uncertainty, with honest inference provenance and restorable snapshots; it has no synthetic Research Plan or identical-reinference guarantee. Exact-model approval and required profile checks gate qualified export in every mode.

Prepared offline work follows the adopted no-lease/reconnect policy: learned disable locks until newer authoritative re-enable, learned tombstones purge before import, and network uncertainty alone is not deletion. R-11 permits one atomically consumed full fallback slot per lineage. The parent contract supplies every detailed authority, money, geometry, lifecycle and UX invariant.

## Mapped Requirements

### AR-26

**AR-26: Deployment and operations.** Separate local/staging/production Supabase, queues, storage, secrets and callback origins in one repo; previews use synthetic data and disabled paid adapters. Verify immutable environment IDs at CI/startup/dispatch; prevent preview/production mixing. Adopt Vercel iad1, Supabase us-east-1, Railway Virginia us-east4-eqdc4a and nearest available Upstash with actual paid plans/topology recorded before acceptance. Pin command/result schemas, generator versions and worker images at Job acceptance; an unavailable compatible worker leaves the Job waiting with a reason. Declare and validate additive compatibility; major changes use separate workers/endpoints. Deploy consumers before producers, retain old consumers until their Jobs terminate, and retain generator images/locks needed by non-deleted reproducible Versions. Use expand/migrate/contract with rollback preserving money/provenance/deletion. Monitor outbox age, leases, failures, unknown costs, storage integrity and purge deadlines with redacted IDs; outages fail authorization closed.

Source: AD-19; R-9; G-9.

Source: `_bmad-output/planning-artifacts/epics.md`, line 685 in the captured input.

### AR-27

**AR-27: Acceptance evidence and remaining work.** Implement real application seams for two-Account API/storage denial, invitation races, replayed commands/callbacks, cancel/delete-versus-result races, concurrent budgets/unknown charges, stale approval, source-policy changes, cache privacy, offline duplicate/conflict sync, deletion-aware restore, canonical/preview transforms, accessible navigation and bilingual exports. Local primitives do not close application gates. G-1/G-2/G-3/G-6/G-9 are PARTIAL, G-5/G-8 BLOCKED and G-4/G-7 NOT RUN; retain these as explicit implementation/qualification obligations. No full release while applicable gates remain open.

Source: Qualification REPORT; architecture implementation gates.

Source: `_bmad-output/planning-artifacts/epics.md`, line 689 in the captured input.

### NFR-1

**NFR-1: Workspace privacy.** Every user-facing and background operation enforces Account ownership. Cross-Account access to private Workspace data must produce no data disclosure.

Source: `_bmad-output/planning-artifacts/epics.md`, line 541 in the captured input.

### NFR-2

**NFR-2: Secret protection.** Login, Invitation Code, recovery, provider, database, queue, signing, and callback-verification secrets are never stored or logged in readable form or exposed through browsers, URLs, prompts, Jobs, Notifications, Source Records, or Exports. Sensitive authentication actions require secure transport and protected sessions. Secrets support redaction, rotation, and revocation.

Source: `_bmad-output/planning-artifacts/epics.md`, line 543 in the captured input.

### NFR-3

**NFR-3: Provenance integrity.** Sources, Cached Research Revisions, Claims, decisions, approvals, repairs, validations, and derivative artifacts retain immutable identity, timestamps, actor, and version relationships. Every Claim pins the exact Source edition or revision, passage, retrieval date, and captured excerpt or content digest examined. Corrections and changed Source content use successor versions rather than mutation. Later printer integration cannot alter the approved evidence-to-geometry record.

Source: `_bmad-output/planning-artifacts/epics.md`, line 545 in the captured input.

### NFR-4

**NFR-4: Durable job state.** Closing the browser, navigating to another Project, or a worker restart cannot lose an accepted Job, corrupt its Project, or misreport its final state.

Source: `_bmad-output/planning-artifacts/epics.md`, line 547 in the captured input.

### NFR-5

**NFR-5: Safe concurrency.** Concurrent Jobs remain isolated and cannot overwrite newer approved Project state. Results generated from stale inputs cannot silently become current.

Source: `_bmad-output/planning-artifacts/epics.md`, line 549 in the captured input.

### NFR-6

**NFR-6: Reproducibility.** Given fixed approved inputs, tool versions, and settings, nova3D reproduces geometrically equivalent Canonical Models within the tolerance ratified through AD-2.

Ratified application: this is evidence-recipe equivalence under R-2 / AR-10. The PRD's AD-2 means PRD:AD-2, not architecture AD-2. Direct inference preserves exact snapshots/provenance without an identical-reinference guarantee.

Source: `_bmad-output/planning-artifacts/epics.md`, line 551 in the captured input.

### NFR-7

**NFR-7: Version durability.** Every Version presented as restorable must restore its geometry and provenance successfully. Deletion under FR-30 is the explicit exception.

Source: `_bmad-output/planning-artifacts/epics.md`, line 555 in the captured input.

### NFR-8

**NFR-8: Explainable failures.** User-facing failures identify the failed stage, known cause, preserved state, cost impact where known, and permitted next action in beginner-friendly language.

Source: `_bmad-output/planning-artifacts/epics.md`, line 557 in the captured input.

### NFR-9

**NFR-9: Cost control.** Paid Work cannot begin without category-specific Project permission, a disclosed maximum charge, and an atomic cost reservation within the available Usage Limit. Usage records, reservations, settlements, and releases must reconcile with each idempotent Job. nova3D must present the resulting spending record clearly enough for Josh to understand and control spending.

Source: `_bmad-output/planning-artifacts/epics.md`, line 559 in the captured input.

### NFR-10

**NFR-10: Responsive workspace.** Research, generation, validation, repair, and export run without blocking navigation or ordinary Project inspection. Browser preview degradation or failure cannot damage manufacturing geometry.

Source: `_bmad-output/planning-artifacts/epics.md`, line 561 in the captured input.

### NFR-11

**NFR-11: Honest print qualification.** Validation labels always identify the Target Print Profile, warnings, failures, unknowns, and last validation time; nova3D never presents validation as safety or universal manufacturability certification.

Source: `_bmad-output/planning-artifacts/epics.md`, line 563 in the captured input.

### NFR-12

**NFR-12: Privacy-preserving cache and deletion.** Shared cached research contains only fields reproducible from identified non-private Sources and cannot expose user identity, private inputs, decisions, or deleted artifacts. Admission rejects all user- and Project-derived fields. Project or whole-Account deletion takes effect immediately through durable tombstones. It blocks late writes and cache promotion, promptly removes active private data, removes remaining copies from operational backups within 30 days, and remains enforced after backup restoration.

Source: PRD §7. All twelve NFRs apply across the capability set, with the explicit mode distinction above. Architecture requirements below supply measurable limits and enforcement contracts.

Source: `_bmad-output/planning-artifacts/epics.md`, line 565 in the captured input.

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
