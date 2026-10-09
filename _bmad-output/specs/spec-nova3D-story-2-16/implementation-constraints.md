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

### AR-3

**AR-3: Transactional contracts.** Use auth-derived Account, UUID command/event/revision identities, expected revisions, SHA-256 content roots and UTC timestamps. Validate schema, ownership and idempotency; replay returns the original receipt and changed payload under the same ID is rejected. Commit business state, Job/reservation and outbox together. Sensitive tables deny browser DML; ownership-scoped foreign keys prevent cross-Workspace links. Redis, queues and client state cannot authorize transitions. Cookie-authenticated mutations require origin and CSRF checks.

Source: AD-2; Consistency Conventions.

Source: `_bmad-output/planning-artifacts/epics.md`, line 616 in the captured input.

### AR-15

**AR-15: Fencing and authenticated service calls.** Each attempt binds input digest, Project revision, live Account authorization/evidence-policy epochs, lease and unique fencing token. Recheck before claim, each external step and publication. Cancel/disable/delete revoke commit authority before best-effort cancellation; stage output by attempt and clean it without publishing late results. Signed service requests bind environment, audience, Job/attempt, payload digest and nonce, expire within five minutes and allow at most 60 seconds skew. Verify native callback signatures and stored dispatch receipts; never infer callback identity from Project ID alone. Keys are Ed25519 pairs per issuer, with receivers holding public keys only. Accept only the active signing key and one explicitly retiring key for the issuer during the outstanding-request window; suspected compromise immediately revokes the key and affected leases. Reject replay mutations.

Source: AD-10; service authentication and delivery conventions.

Source: `_bmad-output/planning-artifacts/epics.md`, line 674 in the captured input.

### AR-26

**AR-26: Deployment and operations.** Separate local/staging/production Supabase, queues, storage, secrets and callback origins in one repo; previews use synthetic data and disabled paid adapters. Verify the immutable environment ID (one Lifecycle `instance_identity` row mirrored by `APP_ENV` and `INSTANCE_ID`) at CI/startup/dispatch; prevent preview/production mixing. Local runs the Supabase CLI stack (`APP_ENV=local` only against a loopback URL); staging and production are separate cloud projects (staging is also its own Vercel project on the `staging` branch), with auth configuration declared in `supabase/config.toml` and diffed against live settings in CI. Adopt Vercel iad1, Supabase us-east-1, Railway Virginia us-east4-eqdc4a and Upstash Redis in its nearest available region and QStash in us-east-1 (set explicitly) on the tiers in R-9, with actual plans/topology recorded before acceptance. Pin command/result schemas, generator versions and worker images at Job acceptance; an unavailable compatible worker leaves the Job waiting with a reason. Declare and validate additive compatibility; major changes use separate workers/endpoints. Deploy consumers before producers, retain old consumers until their Jobs terminate, and retain generator images/locks needed by non-deleted reproducible Versions. Use expand/migrate/contract with rollback preserving money/provenance/deletion. Monitor outbox age, leases, failures, unknown costs, storage integrity, purge deadlines, the newest completed backup snapshot, the last dormant-identity purge and the Auth identity count with redacted IDs; outages fail authorization closed.

Source: AD-19; R-9; G-9.

Source: `_bmad-output/planning-artifacts/epics.md`, line 718 in the captured input.

### NFR-1

**NFR-1: Workspace privacy.** Every user-facing and background operation enforces Account ownership. Cross-Account access to private Workspace data must produce no data disclosure.

Source: `_bmad-output/planning-artifacts/epics.md`, line 574 in the captured input.

### NFR-2

**NFR-2: Secret protection.** Login, Invitation Code, recovery, provider, database, queue, signing, and callback-verification secrets are never stored or logged in readable form or exposed through browsers, URLs, prompts, Jobs, Notifications, Source Records, or Exports. Sensitive authentication actions require secure transport and protected sessions. Secrets support redaction, rotation, and revocation.

Source: `_bmad-output/planning-artifacts/epics.md`, line 576 in the captured input.

### NFR-9

**NFR-9: Cost control.** Paid Work cannot begin without category-specific Project permission, a disclosed maximum charge, and an atomic cost reservation within the available Usage Limit. Usage records, reservations, settlements, and releases must reconcile with each idempotent Job. nova3D must present the resulting spending record clearly enough for Josh to understand and control spending.

Source: `_bmad-output/planning-artifacts/epics.md`, line 592 in the captured input.

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
