# Acceptance Criteria

**Story 6.2: Validate manufacturing mesh structure**

**Epic 6: Qualify and export an evidence-backed printable model.** An approved model can pass exact profile checks, receive bounded audited repair and be downloaded with immutable bilingual provenance.

As an Account owner,
I want to know whether the model is a valid solid,
So that structural defects cannot reach qualified export.

**Requirement IDs:** FR-25, AR-11, NFR-11, UX-DR17, UX-DR59

## Dependencies

- [6.1](../spec-nova3D-story-6-1/SPEC.md)

## Scope

- Validate units, closure/manifoldness, outward orientation, positive/nondegenerate geometry and physical bounds on manufacturing authority.

## Acceptance Criteria

### AC-1

**Given** valid and deliberately defective meshes
**When** structural validation runs
**Then** each required check records pass/warning/fail/unknown for the exact model/profile/transform/tessellation/validator identity

### AC-2

**Given** an unsupported required check or open/nonmanifold/degenerate/out-of-bounds mesh
**When** readiness is evaluated
**Then** unknown or failure blocks qualified export with its reason

### AC-3

**Given** a preview derivative or stale validation record
**When** it is offered as manufacturing evidence
**Then** it cannot substitute for the canonical export mesh and exact validation identity

## Engineering Gates

G-3.

These are acceptance obligations, not claims that the implementation or qualification has passed.
