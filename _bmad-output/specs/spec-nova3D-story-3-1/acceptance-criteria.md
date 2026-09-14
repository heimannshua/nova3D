# Acceptance Criteria

**Story 3.1: Discover and capture licensed source revisions**

**Epic 3: Research and approve a complete evidence plan.** Users can inspect authoritative evidence, control source eligibility, resolve interpretations and approve one complete reconstruction plan.

As an Account owner,
I want to discover relevant authoritative sources,
So that I need not locate or upload the texts myself.

**Requirement IDs:** FR-8, FR-9, AR-6, AR-7, AR-20, NFR-2, NFR-3, NFR-12

## Dependencies

- [2.7](../spec-nova3D-story-2-7/SPEC.md)
- [2.9](../spec-nova3D-story-2-9/SPEC.md)

## Scope

- Discover public sources through constrained acquisition; pin exact Middot editions and permitted evidence retention.

## Acceptance Criteria

### AC-1

**Given** the altar/ramp request
**When** research begins
**Then** Middot chapter 3 governs spatial evidence with Hebrew Torat Emet 357 and English Mishnah Yomit/Joshua Kulp edition metadata pinned; supplementary sources remain labeled

### AC-2

**Given** a retrieved passage
**When** a Source Revision is accepted
**Then** edition, passage/location, retrieval date, examined excerpt or digest, attribution and verified Public Domain/CC0/CC-BY rights are recorded before permitted body retention

### AC-3

**Given** a low-authority page, restricted/ambiguous rights or hostile redirect/payload
**When** acquisition and eligibility run
**Then** leads cannot become accepted evidence without inspectable authorized support; size/type/redirect/private-network restrictions and citation/schema checks reject unsafe input

## Engineering Gates

G-7.

These are acceptance obligations, not claims that the implementation or qualification has passed.
