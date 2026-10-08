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
- [2.6](../spec-nova3D-story-2-6/SPEC.md)
- [2.12](../spec-nova3D-story-2-12/SPEC.md)

## Scope

- Implement provider-neutral Anthropic (claude-sonnet-5-5) and Brave adapters and permission snapshots; provider terms/rates must be verified before enablement, and the Brave adapter ships disabled until the terms review is recorded in the Story 1.10 ledger.
- Use no paid external 3D provider or billable free-credit fallback; instance hosting/local inference remains overhead.
- Disclose each category's maximum using the computed bound of the Story 2.6 calculator.
- Re-match the Project permission to category, provider, purpose, outbound-data categories and disclosed maximum inside the Story 2.6 admission transaction for every operation; a permission never carries over to another category, purpose or Project.
- Provide the provider-bound picture derivative builder (all metadata removed, re-encoded as JPEG, long edge at most 1568 px, at most 5 MB each) that Story 2.13 and later vision operations use; it reads the retained pictures of Story 2.12. A permission covers one category, purpose and provider in one Project; its disclosed maximum is the calculator's bound for the exact payload; it lapses when the Job it was granted for reaches a terminal state or after 7 days, the user can revoke it at any time, and cumulative exposure stays bounded by the Job cap and the Account allowance.

## Acceptance Criteria

### AC-1

**Given** a confirmed research request with default permissions off
**When** a paid category is offered
**Then** provider, purpose, outbound-data categories, retention limitations and maximum are disclosed before explicit permission; the disclosure and permission controls work on phone and desktop

### AC-2

**Given** free-only mode or unverified/unenforceable provider terms
**When** an adapter is asked to dispatch
**Then** no billable request runs; search receives only normalized public subjects and no credentials/private raw prompts

### AC-3

**Given** a permissioned vision/synthesis operation
**When** its outbound payload is formed
**Then** only purpose-required approved content is included, excluding unrelated Workspace data and unapproved personalization; images are the metadata-free provider-bound derivatives

### AC-4

**Given** a permission granted for one category, purpose, provider or Project
**When** an operation for another category, purpose, provider, outbound-data category or Project is admitted, or the disclosed maximum would be exceeded
**Then** admission is refused, because the permission is re-matched at every operation and never carries over

### AC-5

**Given** a granted permission
**When** the user revokes it, its Job ends or 7 days pass
**Then** no further operation is admitted under it

## Engineering Gates

G-6.

These are acceptance obligations, not claims that the implementation or qualification has passed.
