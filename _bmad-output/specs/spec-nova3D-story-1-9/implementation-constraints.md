# Implementation Constraints

Read the [project SPEC](../spec-nova3D/SPEC.md) and every companion it names recursively. Implement only this story's declared slice. Mapped requirements constrain the touched behavior; their other slices remain assigned to the other stories.

## Governing Interpretation

Ratified R-1–R-11 and approved SC-1–SC-7 override conflicting older PRD wording. Whole-plan approval and deterministic recipe equivalence apply to evidence_text/evidence_images. Direct image work uses confirmed ordered images/scope and acknowledged uncertainty, with honest inference provenance and restorable snapshots; it has no synthetic Research Plan or identical-reinference guarantee. Exact-model approval and required profile checks gate qualified export in every mode.

Prepared offline work follows the adopted no-lease/reconnect policy: learned disable locks until newer authoritative re-enable, learned tombstones purge before import, and network uncertainty alone is not deletion. R-11 permits one atomically consumed full fallback slot per lineage. The parent contract supplies every detailed authority, money, geometry, lifecycle and UX invariant.

## Mapped Requirements

### AR-26

**AR-26: Deployment and operations.** Separate local/staging/production Supabase, queues, storage, secrets and callback origins in one repo; previews use synthetic data and disabled paid adapters. Verify the immutable environment ID (one Lifecycle `instance_identity` row mirrored by `APP_ENV` and `INSTANCE_ID`) at CI/startup/dispatch; prevent preview/production mixing. Local runs the Supabase CLI stack (`APP_ENV=local` only against a loopback URL); staging and production are separate cloud projects (staging is also its own Vercel project on the `staging` branch), with auth configuration declared in `supabase/config.toml` and diffed against live settings in CI. Adopt Vercel iad1, Supabase us-east-1, Railway Virginia us-east4-eqdc4a and Upstash Redis in its nearest available region and QStash in us-east-1 (set explicitly) on the tiers in R-9, with actual plans/topology recorded before acceptance. Pin command/result schemas, generator versions and worker images at Job acceptance; an unavailable compatible worker leaves the Job waiting with a reason. Declare and validate additive compatibility; major changes use separate workers/endpoints. Deploy consumers before producers, retain old consumers until their Jobs terminate, and retain generator images/locks needed by non-deleted reproducible Versions. Use expand/migrate/contract with rollback preserving money/provenance/deletion. Monitor outbox age, leases, failures, unknown costs, storage integrity, purge deadlines, the newest completed backup snapshot, the last dormant-identity purge and the Auth identity count with redacted IDs; outages fail authorization closed.

Source: AD-19; R-9; G-9.

Source: `_bmad-output/planning-artifacts/epics.md`, line 718 in the captured input.

### NFR-2

**NFR-2: Secret protection.** Login, Invitation Code, recovery, provider, database, queue, signing, and callback-verification secrets are never stored or logged in readable form or exposed through browsers, URLs, prompts, Jobs, Notifications, Source Records, or Exports. Sensitive authentication actions require secure transport and protected sessions. Secrets support redaction, rotation, and revocation.

Source: `_bmad-output/planning-artifacts/epics.md`, line 576 in the captured input.

### NFR-4

**NFR-4: Durable job state.** Closing the browser, navigating to another Project, or a worker restart cannot lose an accepted Job, corrupt its Project, or misreport its final state.

Source: `_bmad-output/planning-artifacts/epics.md`, line 580 in the captured input.

### AR-18

**AR-18: Identity and administrative enforcement.** Google is the only credential and an Auth identity without an activated Account has no access (no public Account creation); hash/atomically claim invitations for the signed-in verified Google identity and idempotently provision the Account plus Workspace with unusable partial activation. Rate-limit guessing by network origin plus a global budget counted in Postgres, never by Auth identity alone; use codes of at least 128 bits; rotate shared codes only after success. Only the Google provider is enabled (email, phone, anonymous and magic-link sign-in off, asserted in CI) while Supabase sign-ups stay on; registration, invitation and recovery run only in server routes with no database object executable by `anon` or `authenticated`. Delete an Auth identity with no Account 30 days after its last sign-in or registration attempt, under a lock shared with registration. Verify JWT plus live Account and session grant on every private path, including direct RLS/storage access. The sole Administrator cannot impersonate, inspect private Workspaces or grant more administrators. Sensitive actions require fresh authentication (a server-controlled step-up with a 5-minute Postgres marker, consumed by use for Account deletion and close-instance) and immutable audit; recovery is a single-use 15-minute link emailed by the application to the configured Administrator address, and its redemption revokes prior sessions.

Source: AD-12; FR-1–FR-4.

Source: `_bmad-output/planning-artifacts/epics.md`, line 686 in the captured input.

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
