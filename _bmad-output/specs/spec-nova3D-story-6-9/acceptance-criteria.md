# Acceptance Criteria

**Story 6.9: Deliver export packages on phone and computer**

**Epic 6: Qualify and export an evidence-backed printable model.** An approved model can pass exact profile checks, receive bounded audited repair and be downloaded with immutable bilingual provenance.

As an Account owner,
I want to download my exports on phone or computer,
So that large files remain private and access stops when revoked.

**Requirement IDs:** FR-2, FR-3, FR-29, AR-19, NFR-1, NFR-2, UX-DR63

## Dependencies

- [6.8](../spec-nova3D-story-6-8/SPEC.md)
- [4.1](../spec-nova3D-story-4-1/SPEC.md)
- [1.5](../spec-nova3D-story-1-5/SPEC.md)
- [1.8](../spec-nova3D-story-1-8/SPEC.md)
- [1.12](../spec-nova3D-story-1-12/SPEC.md)

## Scope

- Deliver qualified export packages through the Story 1.12 gateway: each file with its content type and file name, and the whole package as one ZIP assembled on the fly by the gateway from the manifest's files in the order listed there (stored, not recompressed). A package is preparing while its manifest roots are verified, ready when every root verifies, and failed otherwise; a browser-native download resumes through its transfer handle (30 minutes at most) and later needs a new ticket; the ZIP is named `<project-slug>-v<n>.zip`, is served as an attachment and carries a `SHA256SUMS` entry listing each file digest from the manifest, which is the verification basis; this story registers the export resolver and the ZIP assembler with the gateway; a foreign or tombstoned export returns the unavailable state.

## Acceptance Criteria

### AC-1

**Given** a large owned export
**When** download or range transfer runs through the Story 1.12 gateway
**Then** each range and each chunk of at most 1 MiB checks live session/Account/Project/artifact state; no reusable signed storage URL is exposed

### AC-2

**Given** disable, deletion or grant revocation during transfer
**When** the next chunk of an export download is authorized
**Then** future chunks stop without cached authorization; previously delivered or in-flight bytes are not claimed recalled

### AC-3

**Given** a phone, an interrupted download or a foreign object
**When** the user requests files
**Then** files and the ZIP download with correct names and content types, an interrupted download resumes through its transfer handle, or with a new ticket after it lapses, from the last byte received, and the downloaded files match the digests in `SHA256SUMS`, a foreign or tombstoned export shows the unavailable state, preparing, ready and failed states are shown, and responses are no-store

## Engineering Gates

This story has no separate gate ID; applicable project-wide gates still govern acceptance.

These are acceptance obligations, not claims that the implementation or qualification has passed.
