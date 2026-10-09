# Sprint Change Proposal: 2026-10-09 — Payments

**Project:** nova3D · **Prepared for:** Josh · **Trigger:** Josh asked to add payment to the app, with the Administrator choosing which user pays and how much.
**Status:** PROPOSED. Nothing in the PRD, Spine, epics or specs has been changed yet.
**Mode:** Batch (your choice). One review, then I apply everything.
**Scope class:** Major. It moves "billing" from out of scope to in scope, adds two PRD requirements and an architecture decision, adds a UX surface and four stories, and touches six existing stories.

Citations are to `planning-artifacts/epics.md` unless noted. `Spine` is `architecture/architecture-nova3D-2026-09-14/ARCHITECTURE-SPINE.md`.

---

## 1. Issue summary

You want users to pay for extra spending allowance by card, with you deciding who is asked and how much. Today the plan excludes this on purpose:

- PRD out of scope: "public registration, billing, storefronts, marketplace functions" (`prd.md:422`).
- Brief: the first milestone excludes "storefronts, sales tooling, collaboration, billing" (`brief.md:50`).
- Project SPEC non-goal: "customer billing, storefronts, sales tooling and marketplaces" (`specs/spec-nova3D/SPEC.md:114`).
- Epics overview: "billing/storefront/marketplace are not implied" (`epics.md:60`).

What exists today is only a spending allowance that you set per user ($25 invitee, $50 Administrator per UTC month, Story 2.4), with atomic reservations (Story 2.6). Nothing collects money.

**Your decisions (2026-10-09):**
1. **Flow:** payment requests. You pick a user and an amount; they pay through a link.
2. **Provider:** Stripe, hosted checkout (card data never touches nova3D).
3. **Amounts:** you choose two numbers each time, the price the card is charged and the credit the user gets.
4. **Review:** one batch review.

A payment request for a named, invited user is not a storefront: there is no catalog, no public checkout and no self-service purchase. Public sign-up, storefronts and marketplaces stay out of scope.

## 2. How it will work

1. You open Usage and limits (AD-03), choose an Account, a **price** in USD ($1.00 to $500.00), the **credit** it buys ($0.01 to $1,000.00, which may be more than the price) and an optional note. This needs your fresh sign-in check and writes an audit event. The request expires in 14 days unless you cancel it first.
2. The user gets an in-app notification and sees the request in Settings: price, credit, note, expiry, the terms and refund policy, and a Pay button.
3. Pay creates a Stripe Checkout page for exactly that price. The user enters their card on Stripe's page.
4. Stripe tells nova3D the payment succeeded through a signed webhook. Only then, in one transaction, nova3D records the payment, adds the credit, marks the request paid, writes an audit event and notifies the user. The page they return to never grants credit itself.
5. **Credit is a separate prepaid balance.** It does not expire while the Account exists and is spent only after that month's allowance is used up. Reservations take from the allowance first and from credit for the rest, and the split is recorded. The $1 per-call and $5 per-Job ceilings are unchanged.
6. **Refunds** are issued by you in the Stripe Dashboard (no refund screen in version 1). A webhook then removes the matching share of credit, up to what is unspent, and flags any shortfall. A **dispute** freezes the credit until it closes.
7. A **daily reconciliation** compares Stripe's successful payments with recorded credit and alarms on any mismatch, through the Story 1.13 alarm channel.

**Safety rules:** credit is granted once per payment however often a webhook repeats; a payment of the wrong amount or currency, for an unknown, expired or cancelled request, or for another Account grants nothing and raises an alarm; webhooks are verified with Stripe's signature; the Stripe secret key is server-only and restricted; previews never get Stripe keys; local and staging use Stripe test mode.

**Privacy:** nova3D stores Stripe IDs, amounts and times, never card data. Stripe receives the user's email and the amount, and keeps its own records under its terms and the law, which users are told before their first payment. Deleting an Account removes its payment requests, payments and credit entries; only non-identifying totals remain.

## 3. Things you must know before approving

- **Stripe availability:** Stripe only opens accounts in supported countries. I do not know where you are. If your country is not supported, the options are a US entity (for example through Stripe Atlas), Paddle as the seller of record, or another provider. The payments port keeps the provider swappable, but I need your answer **before Story 2.16 is built**.
- **Vercel Pro is required.** Taking payments is commercial use, and Vercel's Hobby plan is for non-commercial use. Pro is about $20 a month and is already the planned swap in R-9.
- **Fees:** Stripe typically charges about 2.9% plus $0.30 per US card payment (confirm in your account). Credit larger than price means you subsidize that user.
- **Tax, business registration and the refund policy are yours.** nova3D computes no tax. I am not giving legal advice; check what your country requires before taking money.
- **Disputes and refunds can cost real money** if a user has spent the credit already. The design flags the shortfall; it cannot recover it.
- **Timing:** the four stories can be built after Epic 2's core and do not block Epics 3 to 7. Only account deletion (8.2, 8.3) and final acceptance (8.7) depend on them.

## 4. Impact analysis

| Area | Impact |
| --- | --- |
| **PRD** | New FR-31 (payment requests and hosted payment) and FR-32 (prepaid credit). FR-4 and FR-30 amended. The out-of-scope line and the addendum's "commercial sale" line are narrowed. |
| **Brief and project SPEC** | The "billing" exclusions are narrowed to public billing and storefronts. |
| **Architecture** | New ratified decision R-12 (Payments). Spine: AD-11 (credit and funding split), the ownership table (Usage owns payment requests, payments and credit entries), Stack (Stripe, Vercel Pro), AD-15 (payment data in the deletion manifest, external retention), AD-19 (test mode, previews, alarms), the deferred-items list. Gate G-6 also covers payment seams. R-9 cost note. AD IDs and R-1 to R-11 unchanged. |
| **UX** | New surface S-06 "Credit and payments" (Account owner). AD-03 gains payment-request states. UX-DR74 added; UX-DR71 extended. The surface count goes from 53 to 54 (epics `uxSurfaces`, Story 8.5, validation report). |
| **Epics** | Epic 2 gains Stories 2.14 to 2.17 (73 to 77 stories). Amended: 1.10, 2.6, 8.2, 8.3, 8.5, 8.7. FR-31 and FR-32 join Epic 2's FR list and the coverage map. Planning Assumptions note the change. |
| **Derived artifacts** | Story inputs, per-story specs, index, validation report and manifest regenerated for the 4 new and 6 amended stories (scripted, as in earlier passes). |
| **Sprint tracking** | `sprint-status.yaml` refreshed (4 new `backlog` entries). |
| **Code** | None yet. Nothing is built. |

## 5. Options considered

| Option | Verdict |
| --- | --- |
| **1. Direct adjustment** (add stories to Epic 2, amend six, keep the rest) | **Chosen.** Effort Medium-High (four stories). Risk Medium (money, webhooks, legal). Timeline: adds four stories and a Vercel Pro cost; does not block Epics 3 to 7. |
| 2. Rollback | Not applicable; nothing is built. |
| 3. MVP review / defer | Lower effort alternative: you record outside payments and raise limits in Story 2.4. You asked for payments now, so not chosen. It remains a fallback if Stripe is not available to you. |

## 6. Detailed change proposals

### 6.1 PRD (`prds/prd-nova3D-2026-08-27/prd.md`, `addendum.md`)

**Add FR-31: Payment requests and hosted payment.**
The Administrator can ask a specific invited Account to pay a stated price in USD for a stated amount of credit. The Account owner can pay by card on the payment provider's hosted page. A confirmed payment adds exactly the agreed credit to that Account.
*Consequences:*
- Only the Administrator creates or cancels requests, with fresh authentication and an audit event; price and credit are fixed at creation.
- Card details never reach nova3D.
- Credit is granted once per payment and only after the provider confirms the exact price and currency; repeated or out-of-order notifications grant nothing extra.
- A request can expire or be cancelled; a payment that arrives for one grants nothing and is flagged for refund.
- Refunds and disputes reduce credit by the affected share, up to the unspent balance, and any shortfall is reported.
- Differences between the provider's records and credit are detected and reported to the Administrator.
- nova3D computes no tax. Users see the price, credit and refund policy before paying.

**Add FR-32: Prepaid credit.**
An Account's credit is a separate balance visible to the owner and the Administrator. It is spent only after the monthly allowance, does not expire while the Account exists, and is subject to the same reservation, ceiling and ambiguous-charge rules.
*Consequences:*
- The Administrator can grant credit without a payment, with a reason and an audit event.
- Frozen credit is not available to spend.
- Deleting an Account removes its identifiable payment and credit records; only non-identifying aggregates remain; the provider's own retention is disclosed before the first payment.

**Amend FR-4** — add consequence: "Available headroom is the remaining period allowance plus the credit balance (FR-32)."
**Amend FR-30** — add payment requests, payments and credit entries to the deletion scope, and the provider's retention to the disclosed external limitations.
**Out-of-scope line** (`prd.md:422`): replace "billing, storefronts, marketplace functions" with "public billing, self-service purchasing, storefronts, marketplace functions". Add a dated notice at the top, as for earlier changes.
**Addendum** (`:38`): "Validate repeatable quality across multiple outputs before commercial sale" stays; add that invited-user payment requests are in the first version.

### 6.2 Brief and project SPEC
- `brief.md:50`: narrow "billing" to "public billing" with a notice.
- `specs/spec-nova3D/SPEC.md:114`: "customer billing" becomes "public billing and self-service purchasing". Add CAP wording to the Usage capability.
- `scope-and-readiness.md`: add an override row for the PRD's billing exclusion.

### 6.3 Architecture

**New R-12 — Payments** (`RATIFIED-DECISIONS.md`): decisions 1 to 4 above, plus: USD only; price $1 to $500 and credit $0.01 to $1,000; Stripe Checkout in payment mode, card only; fulfilment only from signed webhooks, idempotent by event ID and verified against amount, currency, request and Account; refunds through the Stripe Dashboard; dispute freezes; daily reconciliation; no tax computation; Vercel Pro; Stripe fees and tax are the Administrator's; provider retention disclosed.

**Spine edits:**
- **AD-11:** add the credit ledger and funding split: headroom is remaining period allowance plus unfrozen credit; a reservation draws from the allowance first, then credit, and records the split; settlement, release and ambiguous holds follow the funding source; ceilings and permissions are unchanged.
- **Ownership table, Usage:** add payment requests, payments, credit entries and freezes.
- **Stack:** add a Stripe row (hosted Checkout, official Node SDK pinned at Story 2.16, API version pinned in each payment record) and mark Vercel as Pro.
- **AD-15:** the deletion manifest covers payment requests, payments and credit entries; payment-provider retention is a disclosed external limitation.
- **AD-19:** test mode in local and staging with a CLI webhook stand-in locally; previews hold no Stripe keys; the payment-mismatch condition joins the alarm list.
- **Deferred items:** the Stripe account and its country, tax, the refund policy text and terms are owned by Josh.
- **G-6 and R-9:** G-6 also covers payment fulfilment, replay, tamper and refund-after-spend seams; R-9's fixed cost note gains Vercel Pro (about $20) and Stripe fees.

### 6.4 UX (`ux-designs/.../SCREEN-INVENTORY.md`, epics inventory)
- **Add S-06 "Credit and payments"** (Account owner): credit balance, pending requests with Pay, payment history, terms and refund policy, Stripe disclosure. States: no credit, pending request, paying (processing), credited, expired or cancelled, refunded, frozen.
- **Extend AD-03 "Usage and limits"** with: create request, request pending, paid, expired, cancelled, credit grant, credit frozen, mismatch alarm.
- **Add UX-DR74** (S-06) and extend **UX-DR71**; update the surface count 53 to 54.

### 6.5 New stories (Epic 2, built after Story 2.10)

**Story 2.14: Hold prepaid credit beside the monthly allowance** — *Account owner* · Requirements: FR-4, FR-32, AR-16, NFR-9, UX-DR71, UX-DR74 · Dependencies: 2.4, 2.6, 2.8, 1.3 · Gate G-6
- Scope: create the Usage-owned immutable credit-entry ledger (grants from payments or from the Administrator, refund debits, spend and release entries, freezes), in USD microdollars; admission headroom is the remaining period allowance plus unfrozen credit; a reservation draws from the allowance first and from credit for the rest and records that split; settlement, release and ambiguous holds follow the funding source; credit carries over when the allowance resets. The Administrator can grant credit without a payment (reason required, at most $1,000, fresh administration marker, audit event). Show allowance and credit to the owner (S-06) and per Account to the Administrator (AD-03).
- AC-1: Given $2 of allowance and $10 of credit left, when a $3 reservation is admitted, then $2 comes from the allowance and $1 from credit, the split is recorded and concurrent reservations cannot exceed allowance plus credit.
- AC-2: Given a credit-funded reservation, when its operation settles lower, is cancelled or is ambiguous, then the unused part returns to the source that funded it, an ambiguous charge keeps its credit part held, and no entry is rewritten.
- AC-3: Given an Administrator credit grant, when it is submitted without a fresh administration marker, without a reason or above $1,000, then it is refused; a valid grant appends an immutable entry and an audit event.
- AC-4: Given a new allowance period, when it resets, then the credit balance carries over unchanged.
- AC-5: Given frozen credit, when a reservation is admitted, then frozen credit is not counted and running Jobs keep their reservations.
- AC-6: Given the Settings and Usage pages, when viewed on phone and desktop, then settled, reserved, available allowance and credit balance reconcile.

**Story 2.15: Request a payment from an Account** — *Administrator* · Requirements: FR-31, FR-3, AR-18, NFR-9, UX-DR71, UX-DR74 · Dependencies: 2.14, 2.10, 1.11, 1.4 · Gate G-6
- Scope: add payment requests to AD-03: choose an Account, price ($1.00 to $500.00, whole cents), credit ($0.01 to $1,000.00) and an optional note of at most 200 characters; the request expires in 14 days or sooner; the Administrator can cancel an unpaid request; at most 3 open requests per Account. Creating or cancelling needs a fresh administration marker and appends an audit event. A Usage-owned request record has states pending, paid, expired and cancelled, with amounts immutable. The owner sees pending requests in S-06 and is notified (Story 2.10). The Administrator sees all requests and states but never card details or Workspace content.
- AC-1: Given a fresh marker, when the Administrator creates a request, then it is stored pending and immutable, an audit event is written and the owner is notified; without a marker it is refused.
- AC-2: Given a price or credit outside bounds, a fourth open request, or a disabled or deleted Account, when it is submitted, then it is rejected with the reason.
- AC-3: Given an expired or cancelled request, when the owner opens it, then it shows that state and cannot be paid.
- AC-4: Given another Account's request, when a different owner opens it, then it is unavailable and discloses nothing.
- AC-5: Given phone and desktop, when requests are listed, created and cancelled, then the same actions work on both.

**Story 2.16: Pay a request through hosted checkout** — *Account owner* · Requirements: FR-31, FR-32, AR-3, AR-15, AR-26, NFR-1, NFR-2, NFR-9, UX-DR74 · Dependencies: 2.15, 1.10, 1.13, 1.9 · Gate G-6
- Scope: a Stripe adapter behind a payments port; server-only creation of a Checkout Session in payment mode (card only, USD, one line at the request's price, `client_reference_id` = request ID, the Account email prefilled), one open session per request (a new one expires the old), success and cancel pages on the app origin that only show status. A webhook route verifies Stripe's signature with the official library, dedupes by event ID, accepts only a paid `checkout.session.completed`, checks amount, currency, request and Account, then in one transaction records the payment (Stripe session and payment-intent IDs, amount), appends the credit grant, marks the request paid, writes an audit event and notifies the owner. A mismatch grants nothing and raises an alarm; a payment for an expired or cancelled request grants nothing and alarms for a manual refund. Use a restricted key, Stripe test mode in local and staging (the Stripe CLI forwards webhooks locally), and no Stripe keys in previews. Store Stripe IDs, amounts and times only. Limit session creation to 10 an hour per Account.
- AC-1: Given a pending request and its owner, when they choose Pay, then a Checkout Session for exactly the request's price in USD is created, any earlier open session is expired and the owner is redirected; another Account cannot create one.
- AC-2: Given a valid signed completed-session event, when the webhook processes it, then exactly one payment, one credit grant of the request's credit, the paid state, an audit event and a notification commit together.
- AC-3: Given the same event delivered twice, concurrently or after the request expired or was cancelled, when it is processed, then credit is granted at most once and a late payment grants nothing and alarms.
- AC-4: Given an invalid signature, a wrong amount or currency, an unknown request, or another Account's event, when received, then nothing is granted, the route returns an error without detail and a mismatch alarms.
- AC-5: Given the success page opened before the webhook arrives, when shown, then it says processing and never grants credit.
- AC-6: Given Stripe unreachable, when Pay is chosen, then an actionable error shows and nothing changes.
- AC-7: Given phone and desktop, when the owner pays, then the same flow works on both.

**Story 2.17: Handle refunds, disputes and payment reconciliation** — *Administrator* · Requirements: FR-31, FR-32, FR-30, AR-26, NFR-9, NFR-12, UX-DR71, UX-DR74 · Dependencies: 2.16, 1.13, 1.9 · Gate G-6
- Scope: refunds are issued in the Stripe Dashboard; `charge.refunded` debits credit by the refunded share up to the unfrozen balance and records any shortfall as unrecovered with an alarm. `charge.dispute.created` freezes the credit from that payment; a won dispute unfreezes it and a lost one debits it. A daily task on the Story 1.9 scheduler lists successful Checkout Sessions from the last 3 days and compares them with payments and credit, alarming (Story 1.13) on any difference. Payment history for the owner (S-06) and the Administrator (AD-03). Before paying, the owner sees the terms and refund policy (text written by Josh) and a notice that Stripe processes the payment and keeps its records under its own terms; Stripe receipts are enabled.
- AC-1: Given a paid request that is partly spent, when Josh refunds it in Stripe and the webhook arrives, then credit is debited by the refunded share up to the available balance, the remainder is recorded as unrecovered and alarmed, and no entry is rewritten.
- AC-2: Given a dispute that is created and then closed won or lost, when the webhooks arrive, then credit is frozen, then unfrozen or debited, the Administrator is alarmed and running Jobs keep their reservations.
- AC-3: Given a successful Stripe session with no recorded payment, or a recorded payment with no successful session, when reconciliation runs, then an alarm names it.
- AC-4: Given the payment history and the terms, when viewed on phone and desktop, then amounts reconcile with credit entries and the terms, refund policy and Stripe notice show before the Pay button.

### 6.6 Existing stories
- **1.10 (provisioning):** add "Before Story 2.16: a Stripe account in a supported country with test and live keys, a restricted API key, a webhook endpoint and secret per environment, receipts on; upgrade Vercel to Pro; write the terms and refund policy text." Add Stripe fees and tax responsibility to the ledger.
- **2.6:** note that credit funding arrives with Story 2.14; until then headroom is the period allowance.
- **8.2 and 8.3:** Account deletion and purge remove payment requests, payments and credit entries (non-identifying totals remain) and the Stripe retention is disclosed; add one AC to 8.3.
- **8.5:** "53" becomes "54" surfaces.
- **8.7:** AC-2's integrated acceptance adds payment seams: webhook replay, tampered amount, late payment, and refund after spend.

### 6.7 Cost
Fixed monthly cost rises by about $20 (Vercel Pro) to roughly $55 to $60 a month, plus Stripe's per-payment fee. Both are Josh's costs.

## 7. Implementation handoff

- **Scope:** Major (PRD scope boundary and requirements change).
- **Route:** PM role for the PRD edits, Architect role for R-12 and the Spine, then the epics update (`bmad-create-epics-and-stories`), regeneration of specs and manifest, an independent audit of the new stories (not skipped this time), then `bmad-sprint-planning` to refresh tracking. All of this is done in this session once you approve.
- **Success criteria:** PRD, brief, SPEC, R-12, Spine, UX and epics agree; 77 stories with 0 parity mismatches and a verified manifest; the independent audit reports no Critical on the new stories; `sprint-status.yaml` shows the four new stories.
- **You still owe, before Story 2.16:** a Stripe account in a supported country, the terms and refund text, and Vercel Pro.
