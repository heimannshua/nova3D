# Implementation Constraints

Read the [project SPEC](../spec-nova3D/SPEC.md) and every companion it names recursively. Implement only this story's declared slice. Mapped requirements constrain the touched behavior; their other slices remain assigned to the other stories.

## Governing Interpretation

Ratified R-1–R-12 and approved SC-1–SC-7 override conflicting older PRD wording. Whole-plan approval and deterministic recipe equivalence apply to evidence_text/evidence_images. Direct image work uses confirmed ordered images/scope and acknowledged uncertainty, with honest inference provenance and restorable snapshots; it has no synthetic Research Plan or identical-reinference guarantee. Exact-model approval and required profile checks gate qualified export in every mode.

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

### FR-3

#### FR-3: Account administration

The Administrator can view Account status and disable or re-enable an invited Account.

**Consequences:**
- Disabling an Account immediately revokes every active session and download authorization.
- A disabled Account cannot authenticate, access its Workspace, or start operations or paid steps.
- Disabling safely cancels active Jobs and rejects any late result so it cannot mutate Workspace or cache state.
- Disabling an Account does not delete its Workspace.
- Administrative capabilities are limited to issuing and revoking Invitation Codes, viewing account status and usage, setting Usage Limits, requesting payments from Accounts and granting Credit, and disabling or re-enabling Accounts.
- Invitation, Usage Limit, disable, re-enable, and recovery actions require fresh Administrator authentication and create immutable security audit events.
- The unique Administrator can recover access only through a single-use, short-lived link sent to the Administrator's verified email address.
- Successful Administrator recovery revokes all existing Administrator sessions and creates an immutable recovery audit event.

Source: PRD §4, FR-3.

**Ratified application:** R-8 / AR-23 governs already-local disconnected data: server access is revoked immediately, while a disconnected device learns disable/deletion on contact. A learned disable cannot be bypassed by returning offline.

Source: `_bmad-output/planning-artifacts/epics.md`, line 96 in the captured input.

### AR-18

**AR-18: Identity and administrative enforcement.** Google is the only credential and an Auth identity without an activated Account has no access (no public Account creation); hash/atomically claim invitations for the signed-in verified Google identity and idempotently provision the Account plus Workspace with unusable partial activation. Rate-limit guessing by network origin plus a global budget counted in Postgres, never by Auth identity alone; use codes of at least 128 bits; rotate shared codes only after success. Only the Google provider is enabled (email, phone, anonymous and magic-link sign-in off, asserted in CI) while Supabase sign-ups stay on; registration, invitation and recovery run only in server routes with no database object executable by `anon` or `authenticated`. Delete an Auth identity with no Account 30 days after its last sign-in or registration attempt, under a lock shared with registration. Verify JWT plus live Account and session grant on every private path, including direct RLS/storage access. The sole Administrator cannot impersonate, inspect private Workspaces or grant more administrators. Sensitive actions require fresh authentication (a server-controlled step-up with a 5-minute Postgres marker, consumed by use for Account deletion and close-instance) and immutable audit; recovery is a single-use 15-minute link emailed by the application to the configured Administrator address, and its redemption revokes prior sessions.

Source: AD-12; FR-1–FR-4.

Source: `_bmad-output/planning-artifacts/epics.md`, line 686 in the captured input.

### NFR-9

**NFR-9: Cost control.** Paid Work cannot begin without category-specific Project permission, a disclosed maximum charge, and an atomic cost reservation within the available headroom (remaining allowance plus unfrozen Credit). Usage records, reservations, settlements, and releases must reconcile with each idempotent Job. nova3D must present the resulting spending record clearly enough for Josh to understand and control spending.

Source: `_bmad-output/planning-artifacts/epics.md`, line 592 in the captured input.

### UX-DR71

**UX-DR71: Usage and limits (AD-03).** Per-Account paid usage, reservations, settlements, available allowance, credit balance, set/reset limit, payment requests and credit grants.

Required states/variants: Under limit, nearly reached, reached, running Job allowed, new paid Job blocked when no credit is left, request pending/paid/expired/cancelled, credit frozen, payment mismatch.

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
