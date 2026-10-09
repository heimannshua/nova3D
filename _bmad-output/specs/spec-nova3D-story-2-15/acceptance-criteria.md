# Acceptance Criteria

**Story 2.15: Request a payment from an Account**

**Epic 2: Confirm requests and control background spending.** Users can submit text or ordered pictures, authorize the exact work and costs, and follow durable jobs without losing approved state, and invited users can pay for extra spending credit.

As an Administrator,
I want to ask a chosen user to pay a chosen amount for a chosen credit,
So that I decide who pays and how much.

**Requirement IDs:** FR-31, FR-3, AR-18, NFR-9, UX-DR71, UX-DR74

## Dependencies

- [2.14](../spec-nova3D-story-2-14/SPEC.md)
- [2.10](../spec-nova3D-story-2-10/SPEC.md)
- [1.11](../spec-nova3D-story-1-11/SPEC.md)
- [1.4](../spec-nova3D-story-1-4/SPEC.md)

## Scope

- Add payment requests to Usage and limits (AD-03): choose an Account, a price ($1.00 to $500.00, whole cents), the credit it buys ($0.01 to $1,000.00, which may exceed the price) and an optional note of at most 200 characters. The Administrator sets an expiry of 1 to 14 days (14 by default), at most 3 are open per Account, and the Administrator can cancel an unpaid one. Creating and cancelling need a fresh administration marker and append an audit event.
- A Usage-owned payment-request record has the states pending, paid (set by Story 2.16), expired and cancelled, with amounts immutable after creation. The owner sees pending requests in Credit and payments (S-06) and gets an in-app notification of a new type registered with Story 2.10. The Administrator sees every request and state but never card details or Workspace content. A disabled or deleted Account cannot receive a request.
- Expired is derived: a pending request past its expiry time reads as expired and no longer counts as open. Cancelling a request expires its open Checkout Session through Story 2.16; if Stripe reports that session already completed, the payment is handled as a late payment.

## Acceptance Criteria

### AC-1

**Given** a fresh administration marker
**When** the Administrator creates a request with an Account, price, credit and note
**Then** it is stored pending and immutable, an audit event is written and the owner is notified; without a marker it is refused

### AC-2

**Given** a price or credit outside the bounds, a fourth open request, or a disabled or deleted Account
**When** it is submitted
**Then** it is rejected with the reason

### AC-3

**Given** an expired or cancelled request
**When** the owner opens it
**Then** it shows that state and cannot be paid

### AC-4

**Given** another Account's request
**When** a different owner opens it
**Then** it is unavailable and discloses nothing

### AC-5

**Given** phone and desktop
**When** requests are listed, created and cancelled
**Then** the same actions work on both

### AC-6

**Given** a request with an open Checkout Session
**When** the Administrator cancels it
**Then** the session is expired, and any payment that still arrives grants nothing and raises an alarm

## Engineering Gates

G-6.

These are acceptance obligations, not claims that the implementation or qualification has passed.
