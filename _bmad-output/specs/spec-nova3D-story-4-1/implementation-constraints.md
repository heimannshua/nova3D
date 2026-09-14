# Implementation Constraints

Read the [project SPEC](../spec-nova3D/SPEC.md) and every companion it names recursively. Implement only this story's declared slice. Mapped requirements constrain the touched behavior; their other slices remain assigned to the other stories.

## Governing Interpretation

Ratified R-1–R-11 and approved SC-1–SC-7 override conflicting older PRD wording. Whole-plan approval and deterministic recipe equivalence apply to evidence_text/evidence_images. Direct image work uses confirmed ordered images/scope and acknowledged uncertainty, with honest inference provenance and restorable snapshots; it has no synthetic Research Plan or identical-reinference guarantee. Exact-model approval and required profile checks gate qualified export in every mode.

Prepared offline work follows the adopted no-lease/reconnect policy: learned disable locks until newer authoritative re-enable, learned tombstones purge before import, and network uncertainty alone is not deletion. R-11 permits one atomically consumed full fallback slot per lineage. The parent contract supplies every detailed authority, money, geometry, lifecycle and UX invariant.

## Mapped Requirements

### AR-2

**AR-2: Module boundaries and ownership.** Use a modular monolith with provider-neutral domain ports and versioned subject packages. Next.js handles commands/web delivery; trusted Railway native workers handle geometry/validation/export and large-file delivery. Models propose validated data, never executable scripts. Retain the architecture's sole ownership of Identity, Projects, Evidence, Geometry, Manufacturing, Artifacts, Jobs, Usage, Preferences/notifications and Lifecycle records; shared invariants use coordinated Postgres transactions.

Source: AD-1, AD-2; Structural Seed.

Source: `_bmad-output/planning-artifacts/epics.md`, line 579 in the captured input.

### AR-3

**AR-3: Transactional contracts.** Use auth-derived Account, UUID command/event/revision identities, expected revisions, SHA-256 content roots and UTC timestamps. Validate schema, ownership and idempotency; replay returns the original receipt and changed payload under the same ID is rejected. Commit business state, Job/reservation and outbox together. Sensitive tables deny browser DML; ownership-scoped foreign keys prevent cross-Workspace links. Redis, queues and client state cannot authorize transitions.

Source: AD-2; Consistency Conventions.

Source: `_bmad-output/planning-artifacts/epics.md`, line 583 in the captured input.

### AR-5

**AR-5: Provenance and immutable publication.** Preserve SourceRevision → ClaimRevision → Detail/Option → PlanRevision/PlanApproval → Parameter → Feature → ModelVersion → ModelApproval/Validation → Export links, including reverse navigation, competing choices, actors and times. Stable logical features have version-specific geometry/claim bindings. Artifacts owns one canonical JSON manifest-root/digest family with immutable ID, ownership, size, kind, byte digest, canonical serialization version, producing activity and child references. Approval, gateway access, restore, cleanup and deletion resolve the same manifest roots; object keys cannot redefine them. Staged output becomes usable/restorable only through verified coordinated publication.

Source: AD-4, AD-13; shared artifact identity.

Source: `_bmad-output/planning-artifacts/epics.md`, line 591 in the captured input.

### AR-19

**AR-19: Revocable artifact transfer.** Keep buckets private and use ownership-scoped immutable keys and quota/lease-bounded upload staging. Verify checksums/content before attachment. Container gateway streams large uploads/downloads/ranges; authorize each range and every chunk of at most 1 MiB against live Account/session/Project/artifact state. Do not expose reusable signed download URLs or cache private responses/authorization; stop future chunks on revocation. Delivered or in-flight bytes cannot be recalled. Cleanup respects active leases.

Source: AD-13; file authorization.

Source: `_bmad-output/planning-artifacts/epics.md`, line 657 in the captured input.

### NFR-1

**NFR-1: Workspace privacy.** Every user-facing and background operation enforces Account ownership. Cross-Account access to private Workspace data must produce no data disclosure.

Source: `_bmad-output/planning-artifacts/epics.md`, line 541 in the captured input.

### NFR-3

**NFR-3: Provenance integrity.** Sources, Cached Research Revisions, Claims, decisions, approvals, repairs, validations, and derivative artifacts retain immutable identity, timestamps, actor, and version relationships. Every Claim pins the exact Source edition or revision, passage, retrieval date, and captured excerpt or content digest examined. Corrections and changed Source content use successor versions rather than mutation. Later printer integration cannot alter the approved evidence-to-geometry record.

Source: `_bmad-output/planning-artifacts/epics.md`, line 545 in the captured input.

### NFR-5

**NFR-5: Safe concurrency.** Concurrent Jobs remain isolated and cannot overwrite newer approved Project state. Results generated from stale inputs cannot silently become current.

Source: `_bmad-output/planning-artifacts/epics.md`, line 549 in the captured input.

### NFR-7

**NFR-7: Version durability.** Every Version presented as restorable must restore its geometry and provenance successfully. Deletion under FR-30 is the explicit exception.

Source: `_bmad-output/planning-artifacts/epics.md`, line 555 in the captured input.

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
