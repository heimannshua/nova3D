# Acceptance Criteria

**Story 2.14: Hold prepaid credit beside the monthly allowance**

**Epic 2: Confirm requests and control background spending.** Users can submit text or ordered pictures, authorize the exact work and costs, and follow durable jobs without losing approved state, and invited users can pay for extra spending credit.

As an Account owner,
I want to have the credit I paid for kept apart from my monthly allowance,
So that what I paid for is spent only on my work and never disappears at month end.

**Requirement IDs:** FR-4, FR-32, AR-16, NFR-9, UX-DR71, UX-DR74

## Dependencies

- [2.4](../spec-nova3D-story-2-4/SPEC.md)
- [2.6](../spec-nova3D-story-2-6/SPEC.md)
- [2.8](../spec-nova3D-story-2-8/SPEC.md)
- [1.3](../spec-nova3D-story-1-3/SPEC.md)

## Scope

- Create the Usage-owned immutable credit-entry ledger in USD microdollars: grants (from payments or from the Administrator), refund debits, spend and release entries, and freezes. An Account's credit balance is the sum of its entries and does not expire while the Account exists.
- Admission headroom is the remaining period allowance plus unfrozen credit. A reservation draws from the allowance first and from credit for the rest and records that split; settlement, release and ambiguous holds follow the funding source; credit carries over when the allowance resets. The per-operation ($1) and per-Job ($5) ceilings and the permission matching of Story 2.5 are unchanged. This story extends the admission function of Story 2.6.
- The Administrator can grant credit without a payment: a reason is required, each grant is at most $1,000, and it needs a fresh administration marker and appends an audit event. Show the allowance and the credit balance to the owner in the new Credit and payments page (S-06) and per Account to the Administrator in Usage and limits (AD-03).
- An overrun above a reservation settles from the allowance first and then credit, may exceed headroom and is recorded as an overrun incident (Story 2.8). The credit balance is net of credit held by reservations, so refund and dispute debits apply only to the unreserved balance. Credit stays spendable when the Administrator sets the allowance limit to $0.

## Acceptance Criteria

### AC-1

**Given** $2 of allowance and $10 of credit left
**When** a $3 reservation is admitted
**Then** $2 comes from the allowance and $1 from credit, the split is recorded, and concurrent reservations cannot exceed allowance plus credit

### AC-2

**Given** a credit-funded reservation
**When** its operation settles lower, is cancelled or is ambiguous
**Then** the unused part returns to the source that funded it, an ambiguous charge keeps its credit part held, and no entry is rewritten; an overrun above the reservation settles from the allowance first and then credit and is recorded as an overrun incident

### AC-3

**Given** an Administrator credit grant
**When** it is submitted without a fresh administration marker, without a reason, or above $1,000
**Then** it is refused, and a valid grant appends an immutable entry and an audit event

### AC-4

**Given** a new allowance period
**When** the allowance resets
**Then** the credit balance carries over unchanged and no credit entry is rewritten

### AC-5

**Given** frozen credit (a fixture freeze until Story 2.17 creates real ones)
**When** a reservation is admitted
**Then** frozen credit is not counted as headroom and running Jobs keep their reservations

### AC-6

**Given** the Credit and payments page and Usage and limits
**When** they are viewed on phone and desktop
**Then** settled, reserved and available allowance and the credit balance reconcile

### AC-7

**Given** an Administrator allowance limit of $0 and $10 of credit
**When** a $3 reservation is admitted
**Then** $3 comes from credit and the allowance is untouched

## Engineering Gates

G-6.

These are acceptance obligations, not claims that the implementation or qualification has passed.
