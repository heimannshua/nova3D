# Acceptance Criteria

**Story 2.16: Pay a request through hosted checkout**

**Epic 2: Confirm requests and control background spending.** Users can submit text or ordered pictures, authorize the exact work and costs, and follow durable jobs without losing approved state, and invited users can pay for extra spending credit.

As an Account owner,
I want to pay a request by card on a secure page,
So that the credit is added without my card details touching nova3D.

**Requirement IDs:** FR-31, FR-32, AR-3, AR-15, AR-26, NFR-1, NFR-2, NFR-9, UX-DR74

## Dependencies

- [2.15](../spec-nova3D-story-2-15/SPEC.md)
- [1.10](../spec-nova3D-story-1-10/SPEC.md)
- [1.13](../spec-nova3D-story-1-13/SPEC.md)
- [1.9](../spec-nova3D-story-1-9/SPEC.md)

## Scope

- Build a Stripe adapter behind a payments port. Server-side only, create a Checkout Session in payment mode (card only, USD, one line at the request's price, the request ID as `client_reference_id`, the Account email prefilled, expiring with the request or after 24 hours, whichever is sooner); a new session for the same request expires the previous one. The success and cancel pages on the application origin only show status. Pin the Stripe SDK and API version, use a restricted key, limit session creation to 10 an hour per Account, and refuse a disabled or deleted Account.
- A webhook route verifies Stripe's signature with the official library, records each processed event ID (unique) and accepts only a paid `checkout.session.completed`. It checks amount, currency, request and Account, then in one transaction records the payment (Stripe session and payment-intent IDs, amount, time), appends the credit grant of Story 2.14, marks the request paid, writes an audit event and notifies the owner. A mismatch, a payment for an expired or cancelled request, or one for a disabled or deleted Account grants nothing and raises a Story 1.13 alarm for a manual refund.
- Local and staging use Stripe test mode (local webhooks are forwarded by the Stripe CLI or a fake implementing the same port); previews hold no Stripe keys; live mode is enabled only in production after the Stripe account is verified. Store Stripe IDs, amounts and times only, never card data.

## Acceptance Criteria

### AC-1

**Given** a pending request and its owner
**When** they choose Pay
**Then** a Checkout Session for exactly the request's price in USD is created, any earlier open session is expired and the owner is redirected; another Account cannot create one and a disabled Account is refused

### AC-2

**Given** a valid signed completed-session event
**When** the webhook processes it
**Then** exactly one payment, one credit grant of the request's credit, the paid state, an audit event and a notification commit together

### AC-3

**Given** the same event delivered twice or concurrently, or a payment for a request that has expired or been cancelled
**When** it is processed
**Then** credit is granted at most once, and a late payment grants nothing and raises an alarm

### AC-4

**Given** an invalid signature, a wrong amount or currency, an unknown request, or another Account's event
**When** it is received
**Then** nothing is granted, the route returns an error without detail, and a mismatch raises an alarm

### AC-5

**Given** the success page opened before the webhook arrives
**When** it is shown
**Then** it says processing and never grants credit

### AC-6

**Given** Stripe unreachable
**When** the owner chooses Pay
**Then** an actionable error is shown and nothing changes

### AC-7

**Given** phone and desktop
**When** the owner pays a request
**Then** the same flow works on both

## Engineering Gates

G-6.

These are acceptance obligations, not claims that the implementation or qualification has passed.
