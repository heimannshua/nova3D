# Acceptance Criteria

**Story 2.1: Confirm natural-language intent and personalization**

**Epic 2: Confirm requests and control background spending.** Users can submit text or ordered pictures, authorize the exact work and costs, and follow durable jobs without losing approved state.

As an Account owner,
I want to describe the desired model and personal additions,
So that work starts from my confirmed intent.

**Requirement IDs:** FR-5, FR-17, AR-4, SC-1, UX-DR8, UX-DR31, UX-DR32, UX-DR36

## Dependencies

- [1.7](../spec-nova3D-story-1-7/SPEC.md)

## Scope

- Persist immutable subject, scope, outcome, mode and optional user-added personalization; clarify ambiguity before research. Personalization is free-form wording mapped to the one supported kind, raised or recessed text on declared surfaces; any other request is explained as unsupported.
- Create the domain-package manifest contract and the registry port, with the Middot manifest holding its registered subject (ID, display name and aliases); later stories add manifest fields as they land. Clarification is deterministic and free: the description is matched against registered subject names and aliases, no match explains the supported subjects and offers picture mode, several matches ask which one, and no billable call is made.
- Personalization applies to evidence modes only; for an image_direct request it is declined with the reason that image-derived models carry no declared surfaces.
- Matching normalizes text (Unicode NFKC, case-folded, Hebrew niqqud removed) and accepts a subject when the description contains one of its aliases as a whole word. The first registered subject is `middot-altar-ramp`, named "The outer altar and ramp (Middot 3)", with aliases including altar, ramp, mizbeach, kevesh, מזבח and כבש; a fixture second subject exercises the several-matches case. Josh approves the alias list with the G-1 corpus.

## Acceptance Criteria

### AC-1

**Given** an ambiguous or invalid description
**When** the user submits it
**Then** clarifications (a choice among several registered subjects) or actionable field errors (no registered subject, with the supported subjects and picture mode offered) appear before any research or paid step; the same actions work on phone and desktop

### AC-2

**Given** an understood request
**When** the user edits and confirms it
**Then** the exact revision records subject, scope, outcome and distinct personalization

### AC-3

**Given** no scope confirmation
**When** start is requested
**Then** no Job begins and scope confirmation is not mistaken for Plan Approval or paid permission

### AC-4

**Given** an image_direct request (a fixture mode until Story 2.3 sets it) with a personalization wish
**When** the request is confirmed
**Then** the wish is declined with that explanation and recorded as not applied

## Engineering Gates

This story has no separate gate ID; applicable project-wide gates still govern acceptance.

These are acceptance obligations, not claims that the implementation or qualification has passed.
