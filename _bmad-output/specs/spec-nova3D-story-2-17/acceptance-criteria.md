# Acceptance Criteria

**Story 2.17: Handle refunds, disputes and payment reconciliation**

**Epic 2: Confirm requests and control background spending.** Users can submit text or ordered pictures, authorize the exact work and costs, and follow durable jobs without losing approved state, and invited users can pay for extra spending credit.

As an Administrator,
I want to have refunds, disputes and mismatches handled safely,
So that credit always matches the money actually kept.

**Requirement IDs:** FR-31, FR-32, FR-30, AR-26, NFR-9, NFR-12, UX-DR71, UX-DR74

## Dependencies

- [2.16](../spec-nova3D-story-2-16/SPEC.md)
- [1.13](../spec-nova3D-story-1-13/SPEC.md)
- [1.9](../spec-nova3D-story-1-9/SPEC.md)

## Scope

- Refunds are issued in the Stripe Dashboard. On `charge.refunded` the webhook debits credit by the refunded share up to the unfrozen balance and records any shortfall as unrecovered with an alarm. On `charge.dispute.created` it freezes the credit from that payment; a won dispute unfreezes it and a lost one debits it.
- A daily task on the Story 1.9 scheduler lists the successful Checkout Sessions of the last three days and compares them with recorded payments and credit, alarming (Story 1.13) on any difference in either direction. Show payment history to the owner (S-06) and the Administrator (AD-03).
- Before the Pay button the owner sees the terms and refund policy (text written by Josh, English until he supplies a Hebrew version, with labels in both catalogs) and a notice that Stripe processes the payment and keeps its own records under its terms and the law. Stripe receipts are enabled in the Stripe account.

## Acceptance Criteria

### AC-1

**Given** a paid request that is partly spent
**When** Josh refunds it in Stripe and the webhook arrives
**Then** credit is debited by the refunded share up to the available balance, the remainder is recorded as unrecovered and alarmed, and no entry is rewritten

### AC-2

**Given** a dispute that is created and then closed won or lost
**When** the webhooks arrive
**Then** the credit is frozen, then unfrozen or debited, the Administrator is alarmed and running Jobs keep their reservations

### AC-3

**Given** a successful Stripe session with no recorded payment, or a recorded payment with no successful session
**When** reconciliation runs
**Then** an alarm names it

### AC-4

**Given** the payment history and the terms
**When** they are viewed on phone and desktop
**Then** amounts reconcile with credit entries, and the terms, refund policy and Stripe notice show before the Pay button

## Engineering Gates

G-6.

These are acceptance obligations, not claims that the implementation or qualification has passed.
