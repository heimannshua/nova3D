# Acceptance Criteria

**Story 6.5: Allow one lineage-bound evidence regeneration**

**Epic 6: Qualify and export an evidence-backed printable model.** An approved model can pass exact profile checks, receive bounded audited repair and be downloaded with immutable bilingual provenance.

As an Account owner,
I want to recover once after local repair fails,
So that automatic recovery has a firm limit.

**Requirement IDs:** FR-28, AR-12, AR-14, AR-16, NFR-3, NFR-9, UX-DR17, UX-DR61

## Dependencies

- [6.4](../spec-nova3D-story-6-4/SPEC.md)
- [5.2](../spec-nova3D-story-5-2/SPEC.md)
- [2.8](../spec-nova3D-story-2-8/SPEC.md)

## Scope

- Manufacturing owns an immutable validation lineage and one full_regeneration slot; this story implements the evidence-plan adapter and shared authority used later by direct reconversion.

## Acceptance Criteria

### AC-1

**Given** failed local repair and an exact approved evidence plan
**When** concurrent fallback triggers arrive
**Then** one unique (lineage_id, full_regeneration) slot commits atomically with successor Job/outbox and required reservation; duplicates return its receipt

### AC-2

**Given** a consumed slot followed by failed dispatch, cancellation, ambiguous charge, child version or retry
**When** another fallback is requested
**Then** none can rearm the slot or evade the original lineage

### AC-3

**Given** the permitted regeneration succeeds or fails
**When** its result is processed
**Then** success preserves the original and creates a candidate needing inspection/approval/full validation; failure stops, and changed interpretations return to Plan Approval

## Engineering Gates

G-3.

These are acceptance obligations, not claims that the implementation or qualification has passed.
