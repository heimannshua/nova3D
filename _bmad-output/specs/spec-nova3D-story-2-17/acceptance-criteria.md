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

- Refunds are issued in the Stripe Dashboard. On `charge.refunded` the webhook debits the cumulative refunded share of the amount paid times the credit that payment granted, rounded up to the microdollar, less debits already applied; the debit comes first from any frozen part and then from the unreserved balance, and any shortfall is recorded as unrecovered with an alarm. On `charge.dispute.created` it freezes the lesser of the unspent credit from that payment and the unfrozen balance; `charge.dispute.closed` with status won or warning_closed unfreezes it and lost debits it. An event that arrives before its payment is recorded waits and is applied when the payment is recorded, or is alarmed by reconciliation if it never is.
- A daily task on the Story 1.9 scheduler lists the Checkout Sessions of this instance (filtered by the instance ID on each session, paginated) that completed and were paid between 3 days and 30 minutes ago and compares them with payment records of any status (a refunded session still counts as recorded), alarming (Story 1.13) on a paid session with no payment record or a granted payment with no paid session. Reconciliation, webhook handlers and alarms skip tombstoned Accounts using the opaque ledger. Show payment history to the owner (S-06) and the Administrator (AD-03).

## Acceptance Criteria

### AC-1

**Given** a paid request that is partly spent
**When** Josh refunds it in Stripe and the webhook arrives
**Then** credit is debited by the refunded share up to the unreserved balance, the remainder is recorded as unrecovered and alarmed, and no entry is rewritten

### AC-2

**Given** a dispute that is created and then closed won, lost or warning_closed
**When** the webhooks arrive
**Then** the credit is frozen, then unfrozen (won or warning_closed) or debited (lost), the Administrator is alarmed and running Jobs keep their reservations

### AC-3

**Given** two partial refunds, and a refund event that arrives before its payment is recorded
**When** the webhooks are processed
**Then** the debits sum to the cumulative refunded share times the credit granted (rounded up once), the early event is applied after the payment is recorded, and no debit is applied twice

### AC-4

**Given** a paid session with no payment record, a granted payment with no paid session, an unfulfilled payment, and a session completed 10 minutes ago
**When** reconciliation runs
**Then** only the first two alarm, the unfulfilled payment is already recorded and is not alarmed again, and the recent session is ignored

### AC-5

**Given** a refund, dispute or reconciliation event for a deleted Account
**When** it is processed
**Then** it changes nothing, raises an alarm that carries only the Stripe reference for manual handling, and leaves no identifying record after the alarm's 30 days

### AC-6

**Given** the payment history
**When** it is viewed on phone and desktop
**Then** amounts reconcile with credit entries and the same actions work on both

## Engineering Gates

G-6.

These are acceptance obligations, not claims that the implementation or qualification has passed.
