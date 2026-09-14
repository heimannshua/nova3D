# Acceptance Criteria

**Story 3.6: Admit and reuse only public-source research**

**Epic 3: Research and approve a complete evidence plan.** Users can inspect authoritative evidence, control source eligibility, resolve interpretations and approve one complete reconstruction plan.

As an Account owner,
I want to reuse eligible research explicitly,
So that reuse saves work without exposing anyone’s private history.

**Requirement IDs:** FR-8, FR-9, FR-14, FR-30, AR-6, AR-20, NFR-3, NFR-12

## Dependencies

- [3.1](../spec-nova3D-story-3-1/SPEC.md)
- [3.2](../spec-nova3D-story-3-2/SPEC.md)
- [3.5](../spec-nova3D-story-3-5/SPEC.md)

## Scope

- Create dedicated source-reproducible allowlisted shared records and private adoption associations.

## Acceptance Criteria

### AC-1

**Given** a proposed shared cache record
**When** admission validates every field
**Then** only identified non-private source-reproducible content is admitted; user/Project IDs, prompts, uploads, decisions, personalization and geometry are rejected

### AC-2

**Given** explicit reuse and a current source policy
**When** a revision is adopted
**Then** immutable original dates and policy snapshots are retained and excluded sources cannot support new conclusions

### AC-3

**Given** fresh research or Project/Account deletion
**When** the cache/adoption paths execute
**Then** fresh work does not substitute cached conclusions and private associations are deleted without promoting tombstoned private data

## Engineering Gates

This story has no separate gate ID; applicable project-wide gates still govern acceptance.

These are acceptance obligations, not claims that the implementation or qualification has passed.
