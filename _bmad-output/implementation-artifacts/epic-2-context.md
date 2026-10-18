# Epic 2 Context: Confirm requests and control background spending

<!-- Compiled from planning artifacts. Edit freely. Regenerate with compile-epic-context if planning docs change. -->

## Goal

Users can submit text or ordered pictures, confirm exactly what is asked, authorize each paid purpose and its maximum cost, and follow durable background Jobs without losing approved state. The Administrator controls and reconciles spending, and invited users can pay for prepaid credit. The epic builds the intake flow and the Job, permission and money machinery that every later research, generation and export epic relies on.

## Stories

- Story 2.1: Confirm natural-language intent and personalization
- Story 2.2: Stage ordered multi-view images privately
- Story 2.3: Choose picture mode and acknowledge uncertainty
- Story 2.12: Retain confirmed pictures as immutable Project artifacts
- Story 2.4: Set accountable usage limits
- Story 2.11: Create durable Job, attempt, step and operation identities
- Story 2.6: Reserve bounded costs atomically
- Story 2.5: Disclose and authorize provider categories
- Story 2.7: Accept and execute durable fenced jobs
- Story 2.8: Reconcile ambiguous charges without replacement calls
- Story 2.13: Identify the pictured subject for research-assisted mode
- Story 2.9: Select research payment and freshness separately
- Story 2.10: Record actionable in-app notifications
- Story 2.14: Hold prepaid credit beside the monthly allowance
- Story 2.15: Request a payment from an Account
- Story 2.16: Pay a request through hosted checkout
- Story 2.17: Handle refunds, disputes and payment reconciliation

(Build order is the order listed, not numeric.)

## Requirements & Constraints

- Subject and scope are confirmed before any research or paid step. Scope confirmation, start confirmation, Plan Approval and paid permission stay distinct and never imply one another.
- Picture intake takes 1 to 12 JPEG, PNG or WebP images (12 MiB each, 60 MiB per request), with a 250 MiB staging quota and 24-hour lease per Account and a 2 GiB retained-picture quota. Retained copies lose location tags; provider-bound copies carry no metadata.
- Paid work needs a default-off, category-specific Project permission (provider, purpose, outbound-data categories, retention limits, maximum) and an atomic cost reservation within headroom (remaining allowance plus unfrozen credit). Duplicate submissions never duplicate reservations, Jobs or charges. Outbound data is limited to purpose-required Project content; search gets normalized public subjects only.
- Default allowance: $25 per invitee, $50 for the Administrator, per UTC month; warn at 80%. Ceilings: $1 per external operation, $5 per research Job across all attempts. A reached limit blocks new paid work but running Jobs finish; Account disable still cancels them.
- Failed work never retries automatically. Failures show stage, cause, preserved state, cost impact and next action.
- Payments are Administrator-initiated, for one Account, at a stated price for stated credit, paid by card on a provider-hosted page. Credit is granted once, only from a verified payment or an audited Administrator grant. The owner sees price, credit, terms and refund policy first. nova3D computes no tax. Account deletion removes identifiable payment and credit records.

## Technical Decisions

- Postgres owns state through narrow transactional commands (auth-derived Account, command ID, expected revision, immutable receipt; same ID with a different payload is rejected). Modules never write each other's tables: Usage owns permissions, rates, reservations, settlements, overrun incidents, allowance periods, credit, payment requests and payments; Jobs owns Jobs, attempts, steps, operations, leases, worker registry and the dispatch outbox; Projects owns request revisions and picture pins.
- Request revisions are immutable, mode `evidence_text`, `evidence_images` or `image_direct`; a mode change makes a successor. Personalization supports only raised or recessed text on declared surfaces. Domain packages publish a versioned manifest through a registry port; a subject in no manifest has no generator.
- Jobs: accepted only when the Job, its reservation and the dispatch outbox commit together. Unique per Job attempt, per attempt step key, per step operation ordinal. A retry waits for the prior potentially chargeable operation to be terminal or reconciled. Steps are signed, environment-bound and fenced; worker lease 120 seconds renewed every 30; a minute QStash sweep publishes outbox rows older than 15 seconds, expires leases and settles ambiguous charges past 24 hours. Zero automatic retries in workflow, queue and provider SDKs. Provider timeout 270 seconds in a 300-second step is ambiguous. At most 3 concurrent Jobs per Account. Cancel or disable revokes commit authority before signalling cancellation.
- Money: integer USD microdollars, one checked integer/rational calculator, versioned immutable rate snapshots, round up once per operation. Reservation = input rate times a provider-independent input bound (request bytes excluding image data, plus 2,000 tokens, plus 5,000 per image, raised 10%) plus output rate times the output limit sent. Admission ceilings: 200,000 input tokens, 16,000 output tokens, 20 search requests. Cache, batch, server-tool, fallback and speed options are unsupported. Ambiguous outcomes hold their reservation until usage evidence or 24 hours, then settle at the reservation; a pre-processing rejection with a request ID is noncharge. Evidence above a reservation settles at the evidence, becomes an overrun incident and blocks that provider until the fresh-authenticated Administrator clears it. Ledgers are append-only.
- Providers: Anthropic `claude-sonnet-5-5` (stateless) for synthesis/vision and Brave Search for discovery, behind adapters; Brave stays disabled until its terms review is recorded in the Story 1.10 ledger. Search and synthesis/vision are separate categories. A permission is re-matched at every operation and lapses when its Job ends or after 7 days.
- Credit: a separate append-only non-expiring ledger. A reservation draws allowance first, then credit, recording the split; settlement, release and ambiguous holds follow the funding source. Administrator grants need a reason, at most $1,000 and a fresh administration marker. Frozen (disputed) credit is not headroom.
- Pictures pass only through the Story 1.12 gateway, never a Vercel function. Retained pictures are manifest roots, and later consumers read them, never staging. Provider-bound derivatives are transient and unstored (metadata removed, JPEG, long edge at most 1568 px, at most 5 MB).
- Payments: Stripe Hosted Checkout (card only, USD), SDK and API version pinned at Story 2.16, Vercel on Pro first. Credit is granted only by a signature-verified webhook (the public route's only authentication) matching a session recorded at creation; mismatches, late payments and duplicates grant nothing and raise Story 1.13 alarms. Price $1 to $500, credit up to $1,000, expiry 1 to 14 days, at most 3 open per Account, Pay refused under 30 minutes left. Refunds are issued in the Stripe Dashboard and debit credit by the refunded share; reconciliation runs daily on the Story 1.9 scheduler. Test mode in local and staging; previews hold no Stripe keys; store IDs, amounts and times only.
- Notifications are one durable record per recipient and event; realtime is only a hint; links recheck live authorization.
- Money and payment stories carry engineering gate G-6, which planning completion does not qualify.

## UX & Interaction Patterns

- Intake sequence: Enter text or Upload picture; understood-request confirmation (subject, scope, outcome, mode, personalization); after scope confirmation, separate free/paid and reuse/fresh choices; a start confirmation summarizes the exact Job without duplicating Plan Approval.
- Camera permission is requested only when Take photo is chosen; denial leaves file selection usable. Direct conversion with incomplete views proceeds only after an explicit Generate anyway acknowledgment.
- Job detail shows state, stage, reason, cost impact when known and cancel. The notification bar and history open the exact item or an unavailable state; Prints in Progress stays Coming later.
- Admin Usage and limits shows settled, reserved and available amounts, credit, limits, overruns, payment requests and grants; the owner's Credit and payments page shows allowance, credit, pending requests with Pay, history, terms and the provider notice. All work on phone and desktop.

## Cross-Story Dependencies

- Needs from Epic 1: 1.7 Projects, 1.12 gateway and signing keys, 1.9 scheduler, 1.13 alarms, 1.5 disable, 1.4 and 1.11 fresh administration marker, 1.8 tombstones, 1.3 audit events, 1.10 provider and Stripe accounts.
- Chains: intake 2.1, 2.2, 2.3, 2.12, then 2.13 and 2.9; money and Jobs 2.4 and 2.11, then 2.6, then 2.5 and 2.7, then 2.8; payments 2.14 (extends the 2.6 admission), 2.15, 2.16, 2.17.
- Fixtures stand in until the owner lands: reservations (2.6), rate schedules (2.5), the `image_direct` mode (2.3), reusable revisions (Story 3.6) and frozen credit (2.17).
- Story 2.7 ships a deterministic test workload; 2.10 registers its event type, and later epics register their own.
- Later epics reuse these: Story 3.1 pins the 2.9 choices; research, generation and reconversion read 2.12 pictures; Story 7.9 reuses the 2.3 quality module; Story 4.1 extends the 2.12 manifest family; Epic 8 deletion covers payments and credit.
