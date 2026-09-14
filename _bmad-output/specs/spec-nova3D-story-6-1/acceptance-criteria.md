# Acceptance Criteria

**Story 6.1: Pin the exact target print profile**

**Epic 6: Qualify and export an evidence-backed printable model.** An approved model can pass exact profile checks, receive bounded audited repair and be downloaded with immutable bilingual provenance.

As an Account owner,
I want to select printer, material and final physical size,
So that validation applies to the intended output.

**Requirement IDs:** FR-24, AR-9, AR-11, NFR-11, UX-DR17, UX-DR58

## Dependencies

- [5.5](../spec-nova3D-story-5-5/SPEC.md)

## Scope

- Pin the complete manufacturer profile inheritance plus explicit application overrides and print transform.

## Acceptance Criteria

### AC-1

**Given** the initial profile
**When** it is selected
**Then** A1 mini 0.4 mm, Bambu PLA Silk+ Gold, ≤90 mm cube, 0.20 mm layers and explicit three perimeters resolve from the pinned inheritance closure

### AC-2

**Given** profile, scale or orientation changes
**When** validation identity is computed
**Then** a new revision makes incompatible prior results stale

### AC-3

**Given** an incomplete or unknown profile
**When** qualification is requested
**Then** missing fields are visible and qualified export is blocked without a universal safety claim

## Engineering Gates

G-3.

These are acceptance obligations, not claims that the implementation or qualification has passed.
