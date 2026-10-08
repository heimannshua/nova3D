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
- [2.4](../spec-nova3D-story-2-4/SPEC.md)
- [2.5](../spec-nova3D-story-2-5/SPEC.md)

## Scope

- Persist operation identity before dispatch and reconcile under that identity; user retries remain under the parent Job.
- List each overrun incident on the Administrator usage page with provider, operation and amounts; only the freshly authenticated Administrator can review and clear it, which re-enables admissions for that provider.
- Register the unknown-cost condition with the Story 1.13 alarm channel: an operation of unknown cost older than 24 hours.
- The 24-hour ambiguous-charge deadline is settled by the Story 2.7 minute sweep.

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

### AC-4

**Given** provider usage above an operation's reservation
**When** the incident is recorded
**Then** it settles at the evidence, counts against every limit, blocks that provider's admissions, and only the freshly authenticated Administrator can review and clear it on the usage page; a clear attempt without a fresh administration marker is refused

### AC-5

**Given** an ambiguous charge past its 24-hour deadline
**When** the Story 2.7 minute sweep runs
**Then** it settles at the reservation exactly once, a repeated sweep changes nothing, and the settlement keeps its ambiguous classification

## Engineering Gates

G-6.

These are acceptance obligations, not claims that the implementation or qualification has passed.
