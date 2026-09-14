---
id: SPEC-nova3D-story-3-1
status: final
companions:
- acceptance-criteria.md
- implementation-constraints.md
- ../spec-nova3D/SPEC.md
sources:
- ../../planning-artifacts/story-inputs/story-3-1.json
---

# Story 3.1: Discover and capture licensed source revisions

## Why

An Account owner needs to discover relevant authoritative sources. They need not locate or upload the texts myself.

## Capabilities

- **CAP-1**
  - **intent:** Discover governing and supplementary reconstruction sources.
  - **success:** Given the altar/ramp request, when research begins, then Middot chapter 3 governs spatial evidence with Hebrew Torat Emet 357 and English Mishnah Yomit/Joshua Kulp edition metadata pinned; supplementary sources remain labeled.

- **CAP-2**
  - **intent:** Retain exact source identity and permitted evidence content.
  - **success:** Given a retrieved passage, when a Source Revision is accepted, then edition, passage/location, retrieval date, examined excerpt or digest, attribution and verified Public Domain/CC0/CC-BY rights are recorded before permitted body retention.

- **CAP-3**
  - **intent:** Reject untrusted acquisition or ineligible evidence.
  - **success:** Given a low-authority page, restricted/ambiguous rights or hostile redirect/payload, when acquisition and eligibility run, then leads cannot become accepted evidence without inspectable authorized support; size/type/redirect/private-network restrictions and citation/schema checks reject unsafe input.

All [acceptance criteria](acceptance-criteria.md) apply to the complete story.

## Constraints

- This story implements the declared slice after its listed dependencies; it does not absorb unrelated parent capabilities.
- The [implementation constraints](implementation-constraints.md) and recursively adopted parent contract are mandatory, including ratified overrides to older source wording.
- Existing product decisions remain binding. Spec completion does not establish implementation, device support or engineering-gate acceptance.

## Non-goals

- Implementing unassigned later-story behavior or creating all future domain entities in advance.
- Adding manual mesh editing, public registration, printer control or commercial storefront behavior.

## Success signal

Middot chapter 3 governs spatial evidence with Hebrew Torat Emet 357 and English Mishnah Yomit/Joshua Kulp edition metadata pinned; supplementary sources remain labeled. The exact criteria demonstrate the complete story outcome and its failure boundaries; any gate-status change requires actual qualification evidence.

## Assumptions

- Story boundaries and ordering are delegated fast-path planning choices; they do not claim separate user approval. Detailed shared assumptions remain in the constraints companion.
