# Acceptance Criteria

**Story 2.8: Reconcile ambiguous charges without replacement calls**

**Epic 2: Confirm requests and control background spending.** Users can submit text or ordered pictures, authorize the exact work and costs, and follow durable jobs without losing approved state.

As an Account owner,
I want to understand and settle uncertain provider costs,
So that retries cannot double-charge me.

**Requirement IDs:** FR-4, FR-6, AR-14, AR-16, AR-17, NFR-9

## Dependencies

- [2.6](../spec-nova3D-story-2-6/SPEC.md)
- [2.7](../spec-nova3D-story-2-7/SPEC.md)

## Scope

- Persist operation identity before dispatch and reconcile under that identity; user retries remain under the parent Job.

## Acceptance Criteria

### AC-1

**Given** a timeout after a potentially chargeable request
**When** its outcome is uncertain
**Then** the full reservation remains and no SDK retry or replacement request is issued

### AC-2

**Given** provider evidence, conservative maximum settlement or proven noncharge
**When** reconciliation completes
**Then** append-only settlement/release records preserve classification; later corrections append entries instead of rewriting history

### AC-3

**Given** a retry, cancellation or allowance reset while a charge is unresolved
**When** another attempt is requested
**Then** it waits for reconciliation, releases only demonstrably unused allowance and cannot bypass the parent-Job lifetime cap

## Engineering Gates

G-6.

These are acceptance obligations, not claims that the implementation or qualification has passed.
