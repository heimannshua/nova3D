# Implementation Constraints

Read the [project SPEC](../spec-nova3D/SPEC.md) and every companion it names recursively. Implement only this story's declared slice. Mapped requirements constrain the touched behavior; their other slices remain assigned to the other stories.

## Governing Interpretation

Ratified R-1–R-11 and approved SC-1–SC-7 override conflicting older PRD wording. Whole-plan approval and deterministic recipe equivalence apply to evidence_text/evidence_images. Direct image work uses confirmed ordered images/scope and acknowledged uncertainty, with honest inference provenance and restorable snapshots; it has no synthetic Research Plan or identical-reinference guarantee. Exact-model approval and required profile checks gate qualified export in every mode.

Prepared offline work follows the adopted no-lease/reconnect policy: learned disable locks until newer authoritative re-enable, learned tombstones purge before import, and network uncertainty alone is not deletion. R-11 permits one atomically consumed full fallback slot per lineage. The parent contract supplies every detailed authority, money, geometry, lifecycle and UX invariant.

## Mapped Requirements

### FR-31

#### FR-31: Payment requests and hosted payment

The Administrator can ask a specific invited Account to pay a stated price in USD for a stated amount of credit. The Account owner can pay by card on the payment provider's hosted page. A confirmed payment adds exactly the agreed credit to that Account.

**Consequences:**
- Only the Administrator creates or cancels payment requests, with fresh authentication and an audit event; price and credit are fixed when the request is created.
- Card details never reach nova3D.
- Credit is granted once per payment and only after the provider confirms the exact price and currency; repeated or out-of-order notifications grant nothing extra.
- A request can expire or be cancelled; a payment that arrives for one grants nothing and is flagged for refund.
- Refunds and disputes reduce credit by the affected share, up to the unspent balance, and any shortfall is reported to the Administrator.
- Differences between the provider's records and recorded credit are detected and reported to the Administrator.
- nova3D computes no tax. The owner sees the price, the credit and the refund policy before paying.

Source: Josh decision 2026-10-09 (sprint change proposal).

**Ratified application:** R-12 fixes the hosted-checkout flow, the amount limits, fulfilment only from signed webhooks, refunds, disputes and daily reconciliation.

Source: `_bmad-output/planning-artifacts/epics.md`, line 481 in the captured input.

### FR-32

#### FR-32: Prepaid credit

An Account's credit is a separate balance that the owner and the Administrator can see. It is spent only after the monthly allowance, does not expire while the Account exists, and follows the same reservation, ceiling and ambiguous-charge rules as the allowance.

**Consequences:**
- The Administrator can grant credit without a payment, with a stated reason and an audit event.
- Credit that is frozen because of a dispute is not available to spend; running Jobs keep their reservations.
- Credit carries over when the monthly allowance resets.
- Deleting an Account removes its identifiable payment and credit records; only non-identifying aggregates may remain, and the provider's own retention is disclosed before the first payment.

Source: Josh decision 2026-10-09 (sprint change proposal).

**Ratified application:** R-12 fixes the funding split (allowance first, then credit), the Administrator grant limits and the freeze on dispute.

Source: `_bmad-output/planning-artifacts/epics.md`, line 498 in the captured input.

### FR-30

#### FR-30: Private Project or Account deletion with non-user-visible research cache

An Account owner can permanently delete individual Projects and Exports or the complete Account and private Workspace after fresh authentication and explicit confirmation.

**Shared deletion guarantees**

- nova3D tombstones and hides the deletion target before cancellation or cleanup begins.
- Deletion cancels affected Jobs and rejects late worker writes and cache promotion so deleted data cannot reappear.
- Active private data is removed promptly. Remaining private copies in operational backups are removed within 30 days.
- Deletion tombstones survive backup restoration and prevent restored private data from becoming active or accessible.
- Any outside provider whose retention cannot satisfy these deletion guarantees must be disclosed before it receives private Project data.

**Project and Export deletion**

- Deletion removes Models, Exports, Personalization, approvals, private prompt wording beyond the normalized research subject, and private Project history from active private storage.

**Permitted shared-cache retention**

- nova3D may retain source-derived Claims and provenance in a shared research cache available to all Accounts.
- A Cached Research Revision may contain only fields reproducible from identified non-private Sources. It cannot contain or reveal Account identity, private prompt wording beyond a normalized research subject, uploaded private material, Personalization, Project decisions, Models, deleted files, or which Account requested a subject.
- Every cached Claim is pinned to immutable Source and Cached Research Revision identities. Corrections create linked successor revisions and cannot silently change evidence already approved by a Project.
- No Account can browse another Account's deleted files or private history through the cache. Reuse cannot recreate a deleted Project or its private decisions.

**Account deletion and instance closure**

- Whole-Account deletion immediately disables access and applies the shared guarantees to every Project, Job, Notification, Export, upload, Personalization item, usage-linked identifier, temporary artifact, and private operational record in that Workspace.
- Only Cached Research Revisions allowed above may remain, and they cannot reveal that the deleted Account requested or used them.
- Payment Requests, payments and Credit entries are private records deleted with the Account; the only payment data that may remain is non-identifying aggregate totals, and the payment provider's own retention is disclosed before the first payment.
- Because the Administrator role is unique and non-transferable in the MVP, ordinary Administrator self-deletion is blocked while an invited Account exists.
- A separate close-instance action remains available after fresh Administrator authentication and explicit destructive confirmation. It tombstones every Account and Workspace without exposing their contents, revokes all sessions and Invitation Codes, cancels all Jobs, rejects late writes, and applies the shared deletion guarantees.
- When no invited Account remains, Administrator self-deletion performs the same close-instance action.

Source: PRD §4, FR-30.

**Ratified application:** R-9 sets active purge at no more than 24 hours and controlled-backup expiry at no more than 30 days from deletion, with deletion-ledger replay before reopening restored access. R-8 excludes disconnected/downloaded copies from remote erasure promises and requires learned tombstones to purge before sync.

Source: `_bmad-output/planning-artifacts/epics.md`, line 445 in the captured input.

### AR-26

**AR-26: Deployment and operations.** Separate local/staging/production Supabase, queues, storage, secrets and callback origins in one repo; previews use synthetic data and disabled paid adapters. Verify the immutable environment ID (one Lifecycle `instance_identity` row mirrored by `APP_ENV` and `INSTANCE_ID`) at CI/startup/dispatch; prevent preview/production mixing. Local runs the Supabase CLI stack (`APP_ENV=local` only against a loopback URL); staging and production are separate cloud projects (staging is also its own Vercel project on the `staging` branch), with auth configuration declared in `supabase/config.toml` and diffed against live settings in CI. Adopt Vercel iad1, Supabase us-east-1, Railway Virginia us-east4-eqdc4a and Upstash Redis in its nearest available region and QStash in us-east-1 (set explicitly) on the tiers in R-9, with actual plans/topology recorded before acceptance. Pin command/result schemas, generator versions and worker images at Job acceptance; an unavailable compatible worker leaves the Job waiting with a reason. Declare and validate additive compatibility; major changes use separate workers/endpoints. Deploy consumers before producers, retain old consumers until their Jobs terminate, and retain generator images/locks needed by non-deleted reproducible Versions. Use expand/migrate/contract with rollback preserving money/provenance/deletion. Monitor outbox age, leases, failures, unknown costs, storage integrity, purge deadlines, the newest completed backup snapshot, the last dormant-identity purge and the Auth identity count with redacted IDs; outages fail authorization closed.

Source: AD-19; R-9; G-9.

Source: `_bmad-output/planning-artifacts/epics.md`, line 718 in the captured input.

### NFR-9

**NFR-9: Cost control.** Paid Work cannot begin without category-specific Project permission, a disclosed maximum charge, and an atomic cost reservation within the available Usage Limit. Usage records, reservations, settlements, and releases must reconcile with each idempotent Job. nova3D must present the resulting spending record clearly enough for Josh to understand and control spending.

Source: `_bmad-output/planning-artifacts/epics.md`, line 592 in the captured input.

### NFR-12

**NFR-12: Privacy-preserving cache and deletion.** Shared cached research contains only fields reproducible from identified non-private Sources and cannot expose user identity, private inputs, decisions, or deleted artifacts. Admission rejects all user- and Project-derived fields. Project or whole-Account deletion takes effect immediately through durable tombstones. It blocks late writes and cache promotion, promptly removes active private data, removes remaining copies from operational backups within 30 days, and remains enforced after backup restoration.

Source: PRD §7. All twelve NFRs apply across the capability set, with the explicit mode distinction above. Architecture requirements below supply measurable limits and enforcement contracts.

Source: `_bmad-output/planning-artifacts/epics.md`, line 598 in the captured input.

### UX-DR71

**UX-DR71: Usage and limits (AD-03).** Per-Account paid usage, reservations, settlements, available allowance, credit balance, set/reset limit, payment requests and credit grants.

Required states/variants: Under limit, nearly reached, reached, running Job allowed, new paid Job blocked, request pending/paid/expired/cancelled, credit frozen, payment mismatch.

Source: SCREEN-INVENTORY AD-03; canonical ux-contract; applicable ratified decisions.

Source: `_bmad-output/planning-artifacts/epics.md`, line 1192 in the captured input.

### UX-DR74

**UX-DR74: Credit and payments (S-06).** Credit balance beside the monthly allowance, pending payment requests with a Pay action, payment history, terms and refund policy, notice that the payment provider processes the payment.

Required states/variants: No credit, request pending, paying (processing), credited, expired or cancelled, refunded, credit frozen.

Source: SCREEN-INVENTORY S-06; canonical ux-contract; applicable ratified decisions.

Source: `_bmad-output/planning-artifacts/epics.md`, line 1210 in the captured input.

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
