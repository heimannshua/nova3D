# Acceptance Criteria

**Story 2.2: Stage ordered multi-view images privately**

**Epic 2: Confirm requests and control background spending.** Users can submit text or ordered pictures, authorize the exact work and costs, and follow durable jobs without losing approved state, and invited users can pay for extra spending credit.

As an Account owner,
I want to choose images or take photos of one subject,
So that the request preserves all useful views.

**Requirement IDs:** AR-7, AR-19, NFR-1, NFR-2, SC-1, SC-3, UX-DR9, UX-DR33

## Dependencies

- [1.4](../spec-nova3D-story-1-4/SPEC.md)
- [1.7](../spec-nova3D-story-1-7/SPEC.md)
- [1.12](../spec-nova3D-story-1-12/SPEC.md)
- [2.1](../spec-nova3D-story-2-1/SPEC.md)

## Scope

- Implement ordered image editing over the Story 1.12 gateway's authenticated, bounded, checksum- and content-checked staging, so no image body crosses a Vercel function. Accept 1 to 12 JPEG, PNG or WebP images (at most 12 MiB each and 60 MiB per request), a 250 MiB staging quota per Account and a 24-hour staging lease renewed by activity.

## Acceptance Criteria

### AC-1

**Given** a phone with no camera permission
**When** Take photo is selected
**Then** permission is requested then; denial leaves existing-file intake usable

### AC-2

**Given** several images of one subject
**When** images are previewed, added, replaced, reordered or removed
**Then** one immutable successor request preserves the resulting ordered digests

### AC-3

**Given** bad files, oversize data or a foreign upload ID
**When** attachment is attempted
**Then** content/ownership/quota checks reject it; private bytes stay in lease-bounded staging and no reusable download URL is exposed

## Engineering Gates

This story has no separate gate ID; applicable project-wide gates still govern acceptance.

These are acceptance obligations, not claims that the implementation or qualification has passed.
