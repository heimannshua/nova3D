# Acceptance Criteria

**Story 2.6: Reserve bounded costs atomically**

**Epic 2: Confirm requests and control background spending.** Users can submit text or ordered pictures, authorize the exact work and costs, and follow durable jobs without losing approved state.

As an Account owner,
I want to start only work with an enforceable maximum,
So that concurrent requests cannot overspend.

**Requirement IDs:** FR-4, AR-3, AR-16, NFR-5, NFR-9

## Dependencies

- [2.4](../spec-nova3D-story-2-4/SPEC.md)
- [2.11](../spec-nova3D-story-2-11/SPEC.md)
- [1.9](../spec-nova3D-story-1-9/SPEC.md)

## Scope

- Use one Usage-owned checked integer/rational calculator and immutable request/options/rate snapshots.
- Reserve against Account period, $5 parent research-Job lifetime across all attempts, and $1 external-operation ceilings in one transaction.
- The reservation is input rate × a provider-independent input bound (the UTF-8 byte length of the serialized request with image data excluded plus 2,000 tokens of fixed overhead and 5,000 tokens per image, all raised by 10%, as the Spine fixes) plus output rate × the output limit actually sent; the 200,000-input-token, 16,000-output-token and 20-search-request ceilings are admission limits. An external operation is one provider request. Treat transport loss, timeout, 5xx and aborted streams as ambiguous (hold the reservation until usage evidence or a 24-hour deadline, then settle at the reservation) and definitive pre-processing rejections with a request ID as noncharge; evidence above a reservation settles at the evidence, counts against every limit and blocks the provider until reviewed.
- Pin the provider API version, requested and returned model identity and rate schedule in each operation receipt; rate schedules are versioned records, so this story needs only fixture rates until Story 2.5 adds the provider adapters.

## Acceptance Criteria

### AC-1

**Given** concurrent operations near any ceiling
**When** maximum costs are reserved
**Then** settled usage plus all outstanding reservations cannot exceed any limit; duplicate admission returns its original receipt

### AC-2

**Given** pinned billing increments and rational rates
**When** the calculator evaluates bounded requests
**Then** it rounds upward once per operation to microdollars and rejects overflow, unknown/foreign rates and unsupported parameters (cache, batch, server tools, fallbacks, speed)

### AC-3

**Given** an unavailable bound or insufficient allowance
**When** admission is attempted
**Then** no external side effect occurs and the user sees the exact cost block

### AC-4

**Given** a request with text and images
**When** the calculator derives the input bound
**Then** it equals the byte length plus 2,000 plus 5,000 per image, raised by 10%, and provider usage evidence above the reservation is recorded as an overrun

## Engineering Gates

G-6.

These are acceptance obligations, not claims that the implementation or qualification has passed.
