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
- Implement the paid mode of the port for items free mode left unresolved: a search step (normalized public subject only), a fetch of the cited page by nova3D, Anthropic claim extraction with schema validation and a citation check, each as its own reserved operation under Story 2.6.
- Checklist details carry typed finite values with original units where the subject has dimensions, and the unit conversion (AD-7) is part of the plan. The independent omission pass is an Evidence-owned review record (reviewer, method, time, subject, findings).

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
**Then** search, fetch, extraction and citation check run as separate reserved operations, output that fails schema or citation validation is rejected, and resolved items keep their source status

## Engineering Gates

This story has no separate gate ID; applicable project-wide gates still govern acceptance.

These are acceptance obligations, not claims that the implementation or qualification has passed.
