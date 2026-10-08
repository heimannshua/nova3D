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
- [2.13](../spec-nova3D-story-2-13/SPEC.md)

## Scope

- In free mode, discover sources only from the domain package's pinned registry (initially Middot chapter 3 Hebrew Torat Emet 357 and English Mishnah Yomit via Sefaria; Sefaria-linked commentaries only if verified free and license-permitted) and keyless allowlisted public endpoints; there is no open-web search.
- The registry lists ordered alternate editions per source; none beyond the two initial editions is chosen yet. Open-web discovery exists only under the paid search category, and only passages nova3D itself fetches from a cited page are pinned. Pin exact Middot editions and permitted evidence retention.
- Extend the Middot manifest with its pinned source registry. Research starts only for a confirmed subject that has a registered package.

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

### AC-4

**Given** an edition whose license or rights cannot be verified
**When** acquisition runs
**Then** no body is stored, the registry's next ordered alternate edition is tried, and if none remains the Job ends with a clear blocked outcome naming the unverified edition

### AC-5

**Given** a request whose subject is unconfirmed or has no registered package
**When** research is started
**Then** the command is refused with the Story 2.13 outcome and no Job, reservation or source request is created

## Engineering Gates

G-7.

These are acceptance obligations, not claims that the implementation or qualification has passed.
