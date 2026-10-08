# Implementation Constraints

Read the [project SPEC](../spec-nova3D/SPEC.md) and every companion it names recursively. Implement only this story's declared slice. Mapped requirements constrain the touched behavior; their other slices remain assigned to the other stories.

## Governing Interpretation

Ratified R-1–R-11 and approved SC-1–SC-7 override conflicting older PRD wording. Whole-plan approval and deterministic recipe equivalence apply to evidence_text/evidence_images. Direct image work uses confirmed ordered images/scope and acknowledged uncertainty, with honest inference provenance and restorable snapshots; it has no synthetic Research Plan or identical-reinference guarantee. Exact-model approval and required profile checks gate qualified export in every mode.

Prepared offline work follows the adopted no-lease/reconnect policy: learned disable locks until newer authoritative re-enable, learned tombstones purge before import, and network uncertainty alone is not deletion. R-11 permits one atomically consumed full fallback slot per lineage. The parent contract supplies every detailed authority, money, geometry, lifecycle and UX invariant.

## Mapped Requirements

### AR-21

**AR-21: Deletion and tested recovery.** Tombstone/hide before cancellation/purge; cover database, images, models, exports, staging, notifications, usage associations and private operational records. Active purge ≤24 h; all controlled private backup copies expire ≤30 days from deletion, never extended by restore/rebackup. Back up the database and objects independently every 12 hours; target RPO/RTO ≤24 h. Persist the minimum restricted anti-resurrection ledger of opaque target identities outside restore rollback and replay before reopening access. Verify interrupted cross-store deletion and restore; apart from that minimum ledger, preserve only permitted public claims/nonidentifying aggregates. Apply sole-Administrator close-instance safeguards and disclose external retention exceptions.

Source: AD-15; R-9; FR-30; G-9.

Source: `_bmad-output/planning-artifacts/epics.md`, line 665 in the captured input.

### AR-26

**AR-26: Deployment and operations.** Separate local/staging/production Supabase, queues, storage, secrets and callback origins in one repo; previews use synthetic data and disabled paid adapters. Verify the immutable environment ID (one Lifecycle `instance_identity` row mirrored by `APP_ENV` and `INSTANCE_ID`) at CI/startup/dispatch; prevent preview/production mixing. Local runs the Supabase CLI stack (`APP_ENV=local` only against a loopback URL); staging and production are separate cloud projects (staging is also its own Vercel project on the `staging` branch), with auth configuration declared in `supabase/config.toml` and diffed against live settings in CI. Adopt Vercel iad1, Supabase us-east-1, Railway Virginia us-east4-eqdc4a and Upstash Redis in its nearest available region and QStash in us-east-1 (set explicitly) on the tiers in R-9, with actual plans/topology recorded before acceptance. Pin command/result schemas, generator versions and worker images at Job acceptance; an unavailable compatible worker leaves the Job waiting with a reason. Declare and validate additive compatibility; major changes use separate workers/endpoints. Deploy consumers before producers, retain old consumers until their Jobs terminate, and retain generator images/locks needed by non-deleted reproducible Versions. Use expand/migrate/contract with rollback preserving money/provenance/deletion. Monitor outbox age, leases, failures, unknown costs, storage integrity, purge deadlines, the newest completed backup snapshot, the last dormant-identity purge and the Auth identity count with redacted IDs; outages fail authorization closed.

Source: AD-19; R-9; G-9.

Source: `_bmad-output/planning-artifacts/epics.md`, line 685 in the captured input.

### NFR-7

**NFR-7: Version durability.** Every Version presented as restorable must restore its geometry and provenance successfully. Deletion under FR-30 is the explicit exception.

Source: `_bmad-output/planning-artifacts/epics.md`, line 555 in the captured input.

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
