---
id: SPEC-nova3D-story-1-6
status: final
companions:
- acceptance-criteria.md
- implementation-constraints.md
- ../spec-nova3D/SPEC.md
sources:
- ../../planning-artifacts/story-inputs/story-1-6.json
---

# Story 1.6: Recover the sole Administrator securely

## Why

The Administrator needs to recover Administrator access. They can regain control without bypassing workspace privacy.

## Capabilities

- **CAP-1**
  - **intent:** Request recovery through the sole Administrator’s verified email.
  - **success:** Given the configured sole Administrator, when recovery is requested, then only the verified email receives the protected link and the response does not expose other Workspaces.

- **CAP-2**
  - **intent:** Reject expired, used or replayed recovery links without granting access.
  - **success:** Given an expired, used or replayed link, when redemption is attempted, then access is denied without partial recovery.

- **CAP-3**
  - **intent:** Recover control while revoking every previous Administrator session.
  - **success:** Given a valid recovery link, when redemption succeeds, then all prior Administrator sessions are revoked and an immutable recovery audit event is recorded.

All [acceptance criteria](acceptance-criteria.md) apply to the complete story.

## Constraints

- This story implements the declared slice after its listed dependencies; it does not absorb unrelated parent capabilities.
- The [implementation constraints](implementation-constraints.md) and recursively adopted parent contract are mandatory, including ratified overrides to older source wording.
- Existing product decisions remain binding. Spec completion does not establish implementation, device support or engineering-gate acceptance.

## Non-goals

- Implementing unassigned later-story behavior or creating all future domain entities in advance.
- Adding manual mesh editing, public registration, printer control or commercial storefront behavior.

## Success signal

Only the verified email receives the protected link and the response does not expose other Workspaces. The exact criteria demonstrate the complete story outcome and its failure boundaries; any gate-status change requires actual qualification evidence.

## Assumptions

- Story boundaries and ordering are delegated fast-path planning choices; they do not claim separate user approval. Detailed shared assumptions remain in the constraints companion.
