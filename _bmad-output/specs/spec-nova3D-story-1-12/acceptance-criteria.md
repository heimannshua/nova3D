# Acceptance Criteria

**Story 1.12: Transfer private files through the authorized gateway**

**Epic 1: Enter and use a private workspace.** Invited users can authenticate and use a responsive private workspace; Josh can control and recover access without inspecting private content.

As an Account owner,
I want to upload and download my private files through one gateway that rechecks my access,
So that files stay private and access stops when it is revoked.

**Requirement IDs:** FR-2, FR-3, AR-15, AR-19, NFR-1, NFR-2

## Dependencies

- [1.5](../spec-nova3D-story-1-5/SPEC.md)
- [1.8](../spec-nova3D-story-1-8/SPEC.md)
- [1.9](../spec-nova3D-story-1-9/SPEC.md)
- [1.10](../spec-nova3D-story-1-10/SPEC.md)

## Scope

- Build `workers/files` on Railway: authenticated large uploads into quota- and lease-bounded staging with checksum and content checks, and downloads and range requests streamed from private Storage in chunks of at most 1 MiB. No user file body crosses a Vercel function, because Vercel Hobby caps request and response bodies at 4.5 MB.
- Authorize with application-signed single-use transfer tickets obtained from a Vercel route: valid for at most five minutes, bound to Account, session grant, target and direction, and carrying no storage credential. The application and gateway share no cookies, so the gateway accepts cross-origin calls only from the application origin and checks live Account, session, Project and artifact state in Postgres before every chunk, never caching the decision; an unreachable database stops the stream.
- Create the versioned service-signing key contract (one active key and one explicitly retiring key; suspected compromise revokes a key and its affected leases at once) that the gateway uses now and Story 2.7 reuses for workers and callbacks. Private responses use no-store and no reusable storage signed URL is ever issued. Staging cleanup runs on the Story 1.9 scheduler and respects active leases.

## Acceptance Criteria

### AC-1

**Given** an authenticated upload within and beyond the quota and size limits
**When** the gateway receives it
**Then** checksum, content type, ownership and quota are enforced before anything is attached, a foreign upload ID is rejected, and the file never passes through a Vercel function

### AC-2

**Given** a large owned file
**When** a download or range transfer runs
**Then** each range and each chunk of at most 1 MiB checks live session, Account, Project and artifact state, no reusable signed storage URL is exposed and responses are no-store

### AC-3

**Given** disable, deletion, grant revocation or an unreachable database during a transfer
**When** the next chunk is authorized
**Then** future chunks stop without cached authorization, and previously delivered or in-flight bytes are not claimed recalled

### AC-4

**Given** a ticket that is expired, replayed, bound to another Account, session or target, or signed with a revoked key
**When** it is presented
**Then** the gateway rejects it; a ticket under the one retiring key is accepted only for its outstanding window, and a compromise revocation rejects it at once

### AC-5

**Given** an interrupted upload or abandoned staging
**When** its lease expires
**Then** cleanup removes only expired staging and observes active leases

## Engineering Gates

This story has no separate gate ID; applicable project-wide gates still govern acceptance.

These are acceptance obligations, not claims that the implementation or qualification has passed.
