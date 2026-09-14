# Acceptance Criteria

**Story 2.5: Disclose and authorize provider categories**

**Epic 2: Confirm requests and control background spending.** Users can submit text or ordered pictures, authorize the exact work and costs, and follow durable jobs without losing approved state.

As an Account owner,
I want to approve each billable purpose and data transfer,
So that paid work uses only the data and maximum I permitted.

**Requirement IDs:** FR-4, FR-14, AR-17, NFR-2, NFR-9, UX-DR8, UX-DR37, UX-DR38

## Dependencies

- [2.1](../spec-nova3D-story-2-1/SPEC.md)
- [2.3](../spec-nova3D-story-2-3/SPEC.md)
- [2.4](../spec-nova3D-story-2-4/SPEC.md)

## Scope

- Implement provider-neutral Anthropic/Brave adapters and permission snapshots; provider terms/rates must be verified before enablement.
- Use no paid external 3D provider or billable free-credit fallback; instance hosting/local inference remains overhead.

## Acceptance Criteria

### AC-1

**Given** a confirmed research request with default permissions off
**When** a paid category is offered
**Then** provider, purpose, outbound-data categories, retention limitations and maximum are disclosed before explicit permission

### AC-2

**Given** free-only mode or unverified/unenforceable provider terms
**When** an adapter is asked to dispatch
**Then** no billable request runs; search receives only normalized public subjects and no credentials/private raw prompts

### AC-3

**Given** a permissioned vision/synthesis operation
**When** its outbound payload is formed
**Then** only purpose-required approved content is included, excluding unrelated Workspace data and unapproved personalization

## Engineering Gates

G-6.

These are acceptance obligations, not claims that the implementation or qualification has passed.
