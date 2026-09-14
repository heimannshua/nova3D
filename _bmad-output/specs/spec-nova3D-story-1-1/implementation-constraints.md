# Implementation Constraints

Read the [project SPEC](../spec-nova3D/SPEC.md) and every companion it names recursively. Implement only this story's declared slice. Mapped requirements constrain the touched behavior; their other slices remain assigned to the other stories.

## Governing Interpretation

Ratified R-1–R-11 and approved SC-1–SC-7 override conflicting older PRD wording. Whole-plan approval and deterministic recipe equivalence apply to evidence_text/evidence_images. Direct image work uses confirmed ordered images/scope and acknowledged uncertainty, with honest inference provenance and restorable snapshots; it has no synthetic Research Plan or identical-reinference guarantee. Exact-model approval and required profile checks gate qualified export in every mode.

Prepared offline work follows the adopted no-lease/reconnect policy: learned disable locks until newer authoritative re-enable, learned tombstones purge before import, and network uncertainty alone is not deletion. R-11 permits one atomically consumed full fallback slot per lineage. The parent contract supplies every detailed authority, money, geometry, lifecycle and UX invariant.

## Mapped Requirements

### AR-1

**AR-1: Starter and pinned runtime.** Epic 1 Story 1 must initialize the official create-next-app 16.3.5 TypeScript/App Router/Tailwind starter with the documented Supabase SSR integration. Preserve Node 24.21.0, React/DOM 19.3.0, TypeScript 5.9.3, Tailwind 4.3.3, supabase-js 2.116.0, ssr 0.12.7, Upstash Workflow 1.3.3/Redis 1.38.4 and Three 0.186.0 as the qualified seed; compatible patches are delegated. Install, typecheck and production-build before accepting the application lockfile. The old with-supabase example's Tailwind 3/lint pins are not the seed. Local probes already pass but the application is unbuilt.

Source: Architecture Stack; R-1; qualification stack report.

Source: `_bmad-output/planning-artifacts/epics.md`, line 575 in the captured input.

### AR-2

**AR-2: Module boundaries and ownership.** Use a modular monolith with provider-neutral domain ports and versioned subject packages. Next.js handles commands/web delivery; trusted Railway native workers handle geometry/validation/export and large-file delivery. Models propose validated data, never executable scripts. Retain the architecture's sole ownership of Identity, Projects, Evidence, Geometry, Manufacturing, Artifacts, Jobs, Usage, Preferences/notifications and Lifecycle records; shared invariants use coordinated Postgres transactions.

Source: AD-1, AD-2; Structural Seed.

Source: `_bmad-output/planning-artifacts/epics.md`, line 579 in the captured input.

### AR-26

**AR-26: Deployment and operations.** Separate local/staging/production Supabase, queues, storage, secrets and callback origins in one repo; previews use synthetic data and disabled paid adapters. Verify immutable environment IDs at CI/startup/dispatch; prevent preview/production mixing. Adopt Vercel iad1, Supabase us-east-1, Railway Virginia us-east4-eqdc4a and nearest available Upstash with actual paid plans/topology recorded before acceptance. Pin command/result schemas, generator versions and worker images at Job acceptance; an unavailable compatible worker leaves the Job waiting with a reason. Declare and validate additive compatibility; major changes use separate workers/endpoints. Deploy consumers before producers, retain old consumers until their Jobs terminate, and retain generator images/locks needed by non-deleted reproducible Versions. Use expand/migrate/contract with rollback preserving money/provenance/deletion. Monitor outbox age, leases, failures, unknown costs, storage integrity and purge deadlines with redacted IDs; outages fail authorization closed.

Source: AD-19; R-9; G-9.

Source: `_bmad-output/planning-artifacts/epics.md`, line 685 in the captured input.

### NFR-2

**NFR-2: Secret protection.** Login, Invitation Code, recovery, provider, database, queue, signing, and callback-verification secrets are never stored or logged in readable form or exposed through browsers, URLs, prompts, Jobs, Notifications, Source Records, or Exports. Sensitive authentication actions require secure transport and protected sessions. Secrets support redaction, rotation, and revocation.

Source: `_bmad-output/planning-artifacts/epics.md`, line 543 in the captured input.

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
