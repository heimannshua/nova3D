---
id: SPEC-nova3D-story-7-8
status: final
companions:
- acceptance-criteria.md
- implementation-constraints.md
- ../spec-nova3D/SPEC.md
sources:
- ../../planning-artifacts/story-inputs/story-7-8.json
---

# Story 7.8: Recover direct models with one pinned reconversion

## Why

An Account owner needs to retry a failed direct model once from their original pictures. A repair failure does not force them to start over, and recovery cannot loop.

## Capabilities

- **CAP-1**
  - **intent:** Use the single shared lineage slot for constrained direct reconversion.
  - **success:** Given failed local repair, an unused shared lineage slot and retained pictures, when reconversion is requested, then the unique slot and the successor Job/outbox commit atomically with the pinned pictures, scope, engine bundle, failed print constraints and a new settings digest, and the screen states that the pictures are processed on the server; the request screen works on phone and desktop.

- **CAP-2**
  - **intent:** Preserve original versions and require renewed approval after successful recovery.
  - **success:** Given an incapable engine, a consumed slot, a second concurrent request or pictures that never synced, when the outcome is recorded, then failure stops without resetting the lineage or starting work and gives an actionable reason, and success preserves the original and returns a new version to inspection, approval and full validation with honest direct provenance; with no compatible engine worker registered the Job waits with a visible reason and the consumed slot stays consumed.

- **CAP-3**
  - **intent:** Keep reconversion output fenced and discard it when authority is revoked.
  - **success:** Given a running reconversion Job, when the Account is disabled, the Project deleted or the attempt superseded, then the attempt's output stays in attempt-scoped staging and is discarded, nothing publishes, and the worker holds no authoritative data after the Job ends.

- **CAP-4**
  - **intent:** Register a notification for a reconversion outcome.
  - **success:** Given a reconversion outcome, when the Job commits it, then one durable notification event is registered for the recipient.

All [acceptance criteria](acceptance-criteria.md) apply to the complete story.

## Constraints

- This story implements the declared slice after its listed dependencies; it does not absorb unrelated parent capabilities.
- The [implementation constraints](implementation-constraints.md) and recursively adopted parent contract are mandatory, including ratified overrides to older source wording.
- Existing product decisions remain binding. Spec completion does not establish implementation, device support or engineering-gate acceptance.

## Non-goals

- Implementing unassigned later-story behavior or creating all future domain entities in advance.
- Adding manual mesh editing, public registration, printer control or commercial storefront behavior.

## Success signal

The unique slot and the successor Job/outbox commit atomically with the pinned pictures, scope, engine bundle, failed print constraints and a new settings digest, and the screen states that the pictures are processed on the server; the request screen works on phone and desktop. The exact criteria demonstrate the complete story outcome and its failure boundaries; any gate-status change requires actual qualification evidence.

## Assumptions

- Story boundaries and ordering are delegated fast-path planning choices; they do not claim separate user approval. Detailed shared assumptions remain in the constraints companion.
