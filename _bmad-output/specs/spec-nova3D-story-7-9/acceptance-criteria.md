# Acceptance Criteria

**Story 7.9: Capture and confirm images on the device**

**Epic 7: Create direct models offline and synchronize safely.** Prepared supported devices can create honestly labeled image-derived models offline, preserve them locally and synchronize without privacy or history loss.

As an Account owner,
I want to choose or photograph images and confirm them without a network,
So that direct conversion can start offline.

**Requirement IDs:** AR-22, NFR-1, SC-1, SC-2, SC-3, UX-DR9, UX-DR13, UX-DR33, UX-DR34, UX-DR35, UX-DR36

## Dependencies

- [7.2](../spec-nova3D-story-7-2/SPEC.md)
- [2.3](../spec-nova3D-story-2-3/SPEC.md)
- [2.12](../spec-nova3D-story-2-12/SPEC.md)
- [1.12](../spec-nova3D-story-1-12/SPEC.md)

## Scope

- Implement local intake in the prepared client: choose images or take photos, order them, and keep them in Account-scoped IndexedDB metadata and OPFS binaries under stable UUIDs for each request, image and later sync command (device timestamps never decide a winner).
- Run the same deterministic quality and coverage checks as Story 2.3 from a shared client module with the Spine's operational-default thresholds; label views, confirm nothing blocks the subject and acknowledge incomplete-coverage uncertainty, all without a network.
- Handle camera permission, unavailable or evicted storage and interrupted capture with recoverable states; explicit sign-out clears the private local stores and account switching never attaches another Account's drafts.
- Confirm subject, scope and outcome on the device (Understood request C-06) before conversion. Opening Account-scoped local data offline requires the Account identity cached on the device by its last sign-in, with no network check and no time lease. Account switching and explicit sign-out are owned here: sign-out purges the private local stores. An image_direct request whose pictures were staged and retained online (Stories 2.2 and 2.12) downloads them into OPFS through the gateway while online, as part of preparing for conversion.

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

### AC-4

**Given** a device whose session expired but whose Account identity was cached by its last sign-in
**When** local drafts are opened offline
**Then** they open with no network check, and after explicit sign-out they do not

### AC-5

**Given** images confirmed on the device
**When** subject, scope and outcome are confirmed
**Then** the request records them locally with the uncertainty acknowledgment and is ready for conversion

## Engineering Gates

G-8.

These are acceptance obligations, not claims that the implementation or qualification has passed.
