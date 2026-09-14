# Acceptance Criteria

**Story 6.9: Stream private files with live revocation**

**Epic 6: Qualify and export an evidence-backed printable model.** An approved model can pass exact profile checks, receive bounded audited repair and be downloaded with immutable bilingual provenance.

As an Account owner,
I want to download my exports on phone or computer,
So that large files remain private and access stops when revoked.

**Requirement IDs:** FR-2, FR-3, FR-29, AR-19, NFR-1, NFR-2, UX-DR63

## Dependencies

- [6.8](../spec-nova3D-story-6-8/SPEC.md)
- [4.1](../spec-nova3D-story-4-1/SPEC.md)
- [1.5](../spec-nova3D-story-1-5/SPEC.md)

## Scope

- Use the container gateway for large authenticated downloads/ranges and existing staging uploads.

## Acceptance Criteria

### AC-1

**Given** a large owned export
**When** download or range transfer runs
**Then** each range and each chunk of at most 1 MiB checks live session/Account/Project/artifact state; no reusable signed storage URL is exposed

### AC-2

**Given** disable, deletion or grant revocation during transfer
**When** the next chunk is authorized
**Then** future chunks stop without cached authorization; previously delivered or in-flight bytes are not claimed recalled

### AC-3

**Given** phone file handling, interrupted download or a foreign object
**When** the user requests files
**Then** usable preparing/ready/failed states and individual/package downloads remain private with no-store responses and lease-aware cleanup

## Engineering Gates

This story has no separate gate ID; applicable project-wide gates still govern acceptance.

These are acceptance obligations, not claims that the implementation or qualification has passed.
