# Acceptance Criteria

**Story 7.3: Convert and retain image-derived models locally**

**Epic 7: Create direct models offline and synchronize safely.** Prepared supported devices can create honestly labeled image-derived models offline, preserve them locally and synchronize without privacy or history loss.

As an Account owner,
I want to generate from confirmed images without internet,
So that my direct model remains usable on its device.

**Requirement IDs:** FR-16, FR-17, AR-4, AR-5, AR-22, SC-1, SC-2, SC-3, UX-DR7, UX-DR13, UX-DR35, UX-DR50

## Dependencies

- [7.2](../spec-nova3D-story-7-2/SPEC.md)
- [2.3](../spec-nova3D-story-2-3/SPEC.md)
- [4.1](../spec-nova3D-story-4-1/SPEC.md)
- [4.6](../spec-nova3D-story-4-6/SPEC.md)

## Scope

- Execute the qualified direct engine in a dedicated worker and retain exact immutable image/scope/engine/settings/output snapshots.

## Acceptance Criteria

### AC-1

**Given** verified preparation, ordered confirmed images/scope and uncertainty acknowledgment with no network
**When** direct conversion runs
**Then** a local model and provenance persist and reopen offline without network inference or a synthetic Research Plan

### AC-2

**Given** direct features or personal additions
**When** the model is inspected
**Then** image/inference uncertainty and user-added provenance remain distinct from historically evidenced claims; identical re-inference is not promised

### AC-3

**Given** inference interruption or failure
**When** the user returns to the Project
**Then** preserved inputs/drafts and actionable status remain, with no silent upload or paid cloud fallback

## Engineering Gates

G-8.

These are acceptance obligations, not claims that the implementation or qualification has passed.
