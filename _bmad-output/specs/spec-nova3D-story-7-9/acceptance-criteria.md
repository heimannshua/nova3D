# Acceptance Criteria

**Story 7.9: Capture and confirm images on the device**

**Epic 7: Create direct models offline and synchronize safely.** Prepared supported devices can create honestly labeled image-derived models offline, preserve them locally and synchronize without privacy or history loss.

As an Account owner,
I want to choose or photograph images and confirm them without a network,
So that direct conversion can start offline.

**Requirement IDs:** AR-22, NFR-1, SC-1, SC-2, SC-3, UX-DR9, UX-DR13, UX-DR33, UX-DR34, UX-DR35

## Dependencies

- [7.2](../spec-nova3D-story-7-2/SPEC.md)
- [2.3](../spec-nova3D-story-2-3/SPEC.md)

## Scope

- Implement local intake in the prepared client: choose images or take photos, order them, and keep them in Account-scoped IndexedDB metadata and OPFS binaries under stable UUIDs for each request, image and later sync command (device timestamps never decide a winner).
- Run the same deterministic quality and coverage checks as Story 2.3 from a shared client module with the Spine's operational-default thresholds; label views, confirm nothing blocks the subject and acknowledge incomplete-coverage uncertainty, all without a network.
- Handle camera permission, unavailable or evicted storage and interrupted capture with recoverable states; explicit sign-out clears the private local stores and account switching never attaches another Account's drafts.

## Acceptance Criteria

### AC-1

**Given** a prepared device with no network
**When** the user chooses files or takes photos
**Then** ordered images are stored locally under stable UUIDs, camera denial leaves file intake usable, and the flow works on phone and desktop

### AC-2

**Given** fixture images
**When** local quality and coverage checks run
**Then** the results equal those of Story 2.3 for the same images, and incomplete direct inputs need an explicit uncertainty acknowledgment pinned to the ordered image digests

### AC-3

**Given** unavailable storage, eviction, interruption or sign-out
**When** intake is used
**Then** recoverable states preserve what remains, sign-out clears the private local stores and another Account's drafts are never attached

## Engineering Gates

G-8.

These are acceptance obligations, not claims that the implementation or qualification has passed.
