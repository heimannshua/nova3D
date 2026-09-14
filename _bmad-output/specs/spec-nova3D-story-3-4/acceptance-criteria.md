# Acceptance Criteria

**Story 3.4: Inspect sources and choose defensible interpretations**

**Epic 3: Research and approve a complete evidence plan.** Users can inspect authoritative evidence, control source eligibility, resolve interpretations and approve one complete reconstruction plan.

As an Account owner,
I want to compare explanations and alternatives,
So that I can select an interpretation with its geometry consequences.

**Requirement IDs:** FR-9, FR-11, AR-5, UX-DR5, UX-DR6, UX-DR11, UX-DR42, UX-DR46, UX-DR47

## Dependencies

- [3.3](../spec-nova3D-story-3-3/SPEC.md)

## Scope

- Provide original/translation/explanation reader and competing options linked to exact claims and affected details.

## Acceptance Criteria

### AC-1

**Given** Hebrew and English source content
**When** the reader opens during research
**Then** original, translation, citation and explanation remain distinct and readable without pausing the Job

### AC-2

**Given** competing defensible options
**When** the user reviews a detail
**Then** recommended and rejected options retain support, conflicts, reasoning and expected geometry effects

### AC-3

**Given** no settled recommendation
**When** approval is considered
**Then** a required explicit choice is obtained rather than silently inventing certainty

## Engineering Gates

This story has no separate gate ID; applicable project-wide gates still govern acceptance.

These are acceptance obligations, not claims that the implementation or qualification has passed.
