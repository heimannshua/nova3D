# Acceptance Criteria

**Story 7.7: Deliver optional private phone push**

**Epic 7: Create direct models offline and synchronize safely.** Prepared supported devices can create honestly labeled image-derived models offline, preserve them locally and synchronize without privacy or history loss.

As an Account owner,
I want to receive useful phone alerts,
So that I can return to completed work without losing in-app history.

**Requirement IDs:** FR-7, AR-25, SC-5, UX-DR18, UX-DR65

## Dependencies

- [2.10](../spec-nova3D-story-2-10/SPEC.md)
- [6.9](../spec-nova3D-story-6-9/SPEC.md)

## Scope

- Implement category preferences and contextual install/permission guidance for research/generation/validation/export; printing remains inactive.

## Acceptance Criteria

### AC-1

**Given** an enabled category and a committed event
**When** push delivery is attempted
**Then** payloads contain opaque references and generic category text, not private names, images or source excerpts

### AC-2

**Given** permission denied, alerts off or failed/duplicate delivery
**When** the event is reviewed
**Then** essential in-app history remains intact and deduplicated; delivery is not falsely guaranteed

### AC-3

**Given** a received alert
**When** it is selected
**Then** live authorization opens the exact related item or shows its unavailable state

## Engineering Gates

This story has no separate gate ID; applicable project-wide gates still govern acceptance.

These are acceptance obligations, not claims that the implementation or qualification has passed.
