# Acceptance Criteria

**Story 3.3: Account for every consequential physical detail**

**Epic 3: Research and approve a complete evidence plan.** Users can inspect authoritative evidence, control source eligibility, resolve interpretations and approve one complete reconstruction plan.

As an Account owner,
I want to see complete evidence and unresolved gaps,
So that I do not approve a reconstruction with hidden omissions.

**Requirement IDs:** FR-10, FR-11, FR-12, AR-6, NFR-3, NFR-8, UX-DR45, UX-DR46

## Dependencies

- [3.1](../spec-nova3D-story-3-1/SPEC.md)
- [3.2](../spec-nova3D-story-3-2/SPEC.md)

## Scope

- Build the finite subject-specific detail checklist, statuses and independent omission review; product FRs are not physical detail records.
- Implement the research-engine port with deterministic domain-package extractors that map governing text to checklist items, and the separate omission scan driven by a versioned grammar of quantity, relational, material and placement phrases. Free mode counts as complete only for domain-registered subjects, only after the scan finds omissions seeded into a fixture and an independent human or other-engine pass covers the first registry subject.
- Extend the Middot manifest with its detail checklist.
- Implement the paid mode of the port for items free mode left unresolved: a search step (normalized public subject only), a fetch of the cited page by nova3D, Anthropic claim extraction with schema validation and a citation check, where each provider request (search, extraction) is an ExternalOperation reserved under Story 2.6, and the fetch and the citation check are bounded local steps (5 MiB, 10 seconds). Extraction sends only the cited section of the fetched page, converted to text and capped at 20 KB.
- Checklist details carry typed finite values with original units where the subject has dimensions, and the unit conversion (AD-7) is part of the plan. The independent omission pass is an Evidence-owned review record (reviewer, method, time, subject, findings).
- The domain package declares a unit table: each historical unit with its candidate definitions in millimetres, each cited to a governing source in the registry. The plan's conversion is one of those candidates, chosen at Plan Approval, and Josh approves the table's content with the G-1 corpus. The independent omission pass is performed by Josh or by a second-engine pass that he records.
- In paid mode a fetched page can become a Source Revision only when its licence is verified as Public Domain, CC0 or CC-BY from machine-readable metadata or an explicit licence statement; otherwise it stays a lead.

## Acceptance Criteria

### AC-1

**Given** a requested reconstruction scope
**When** completeness is assessed
**Then** shape, dimensions, materials, placement, printability and historical interpretation are accounted for with evidence or explicit sourced/inferred/disputed/unknown/user-added status; the same actions work on phone and desktop; dimensional details carry typed values with their original units

### AC-2

**Given** a missing checklist item or unresolved independent-review gap
**When** plan readiness is evaluated
**Then** whole-plan approval is blocked until the gap is resolved; the separate omission pass is retained

### AC-3

**Given** uncertainty or a personal addition
**When** a detail is displayed
**Then** evidence, reasoning/confidence, expected geometry effect and honest status are visible without fabricated historical detail

### AC-4

**Given** a fixture whose governing text contains seeded omissions
**When** the omission scan runs
**Then** every seeded omission surfaces as a gap, and free mode cannot report complete for the first registry subject until an independent human or other-engine pass is recorded

### AC-5

**Given** paid expansion with the search and synthesis permissions and unresolved items
**When** the paid steps run
**Then** the search and extraction requests are separate reserved operations, the fetch and citation check run as bounded steps, output that fails schema or citation validation is rejected, and resolved items keep their source status

### AC-6

**Given** a paid-mode fetched page without verifiable licence metadata
**When** extraction runs
**Then** it remains a lead and cannot support an approved claim

## Engineering Gates

This story has no separate gate ID; applicable project-wide gates still govern acceptance.

These are acceptance obligations, not claims that the implementation or qualification has passed.
