# Acceptance Criteria

**Story 7.8: Recover direct models with one pinned reconversion**

**Epic 7: Create direct models offline and synchronize safely.** Prepared supported devices can create honestly labeled image-derived models offline, preserve them locally and synchronize without privacy or history loss.

As an Account owner,
I want to retry a failed direct model once from my original pictures,
So that a repair failure does not force me to start over, and recovery cannot loop.

**Requirement IDs:** FR-28, AR-12, AR-22, SC-1, SC-2, UX-DR17, UX-DR61, AR-14, AR-15, FR-7

## Dependencies

- [7.6](../spec-nova3D-story-7-6/SPEC.md)
- [6.5](../spec-nova3D-story-6-5/SPEC.md)
- [2.12](../spec-nova3D-story-2-12/SPEC.md)
- [7.4](../spec-nova3D-story-7-4/SPEC.md)
- [2.7](../spec-nova3D-story-2-7/SPEC.md)

## Scope

- Integrate direct snapshots with the existing full-regeneration slot: one reconversion in the validation lineage, run as a fenced Job on the Railway engine worker (`workers/engine`) through the Story 2.7 machinery, from the Project's retained pictures (Story 2.12, synced by Story 7.4), the confirmed scope, the original pinned engine bundle and the failed print constraints, with a new settings digest.
- The request screen states that the retained pictures are processed on the server. No provider is called, so no paid permission or reservation applies; admission checks that the Account is active, the lineage slot is unused and no other reconversion is running for the Account. A model whose pictures never synced cannot start it and says why. Reconversion is never a fallback for failed local inference.
- For an image-derived lineage the successor's exact scale is recomputed from the inherited confirmed dimension and the engine port's declared reference measurement on the new mesh; a mesh that does not fit fails and is never rescaled afterwards. If no compatible engine worker is registered the Job waits with a visible reason, and the consumed slot is not rearmed.

## Acceptance Criteria

### AC-1

**Given** failed local repair, an unused shared lineage slot and retained pictures
**When** reconversion is requested
**Then** the unique slot and the successor Job/outbox commit atomically with the pinned pictures, scope, engine bundle, failed print constraints and a new settings digest, and the screen states that the pictures are processed on the server; the request screen works on phone and desktop

### AC-2

**Given** an incapable engine, a consumed slot, a second concurrent request or pictures that never synced
**When** the outcome is recorded
**Then** failure stops without resetting the lineage or starting work and gives an actionable reason, and success preserves the original and returns a new version to inspection, approval and full validation with honest direct provenance; with no compatible engine worker registered the Job waits with a visible reason and the consumed slot stays consumed

### AC-3

**Given** a running reconversion Job
**When** the Account is disabled, the Project deleted or the attempt superseded
**Then** the attempt's output stays in attempt-scoped staging and is discarded, nothing publishes, and the worker holds no authoritative data after the Job ends

### AC-4

**Given** a reconversion outcome
**When** the Job commits it
**Then** one durable notification event is registered for the recipient

## Engineering Gates

G-3, G-8.

These are acceptance obligations, not claims that the implementation or qualification has passed.
