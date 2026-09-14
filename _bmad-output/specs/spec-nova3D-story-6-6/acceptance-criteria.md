# Acceptance Criteria

**Story 6.6: Define and validate the shared provenance envelope**

**Epic 6: Qualify and export an evidence-backed printable model.** An approved model can pass exact profile checks, receive bounded audited repair and be downloaded with immutable bilingual provenance.

As an Account owner,
I want to retain a consistent source record with every export,
So that model and evidence remain reciprocal across runtimes.

**Requirement IDs:** FR-19, FR-29, AR-5, AR-13, NFR-3

## Dependencies

- [4.5](../spec-nova3D-story-4-5/SPEC.md)
- [5.5](../spec-nova3D-story-5-5/SPEC.md)
- [6.5](../spec-nova3D-story-6-5/SPEC.md)

## Scope

- Implement schema 1.0.0 / JSON Schema Draft 2020-12 and shared TypeScript/Python validation for the five required groups.

## Acceptance Criteria

### AC-1

**Given** an export provenance document
**When** both runtimes validate it
**Then** header, evidence, approvals, geometry and manufacturing preserve all architecture-defined identities and relationships

### AC-2

**Given** missing links, a changed model digest or incompatible schema
**When** validation runs
**Then** the envelope is rejected and no orphaned feature/claim or mismatched approval enters an export

### AC-3

**Given** the complete evidence fixture
**When** reciprocal navigation and records are checked
**Then** exact editions/passages, choices, personalization, profile, every check and repair resolve from one immutable manifest

## Engineering Gates

G-4.

These are acceptance obligations, not claims that the implementation or qualification has passed.
