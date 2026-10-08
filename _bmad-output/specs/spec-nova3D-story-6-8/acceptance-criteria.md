# Acceptance Criteria

**Story 6.8: Assemble qualified manufacturing exports**

**Epic 6: Qualify and export an evidence-backed printable model.** An approved model can pass exact profile checks, receive bounded audited repair and be downloaded with immutable bilingual provenance.

As an Account owner,
I want to download an approved printable model with its record,
So that the file package matches the model I accepted.

**Requirement IDs:** FR-29, AR-4, AR-5, AR-13, NFR-3, NFR-11, UX-DR62, UX-DR63, FR-7

## Dependencies

- [6.3](../spec-nova3D-story-6-3/SPEC.md)
- [6.6](../spec-nova3D-story-6-6/SPEC.md)
- [6.7](../spec-nova3D-story-6-7/SPEC.md)
- [1.12](../spec-nova3D-story-1-12/SPEC.md)

## Scope

- Create primary 3MF, optional STL, structured provenance and PDF as one immutable qualified package.
- Assemble the package as one deterministic ZIP (stored entries, entry times fixed to the export commit time, sorted names, CRC-32 computed at assembly) holding the files and a `SHA256SUMS` listing (`<hex>  <name>` lines), and publish it as a manifest root.

## Acceptance Criteria

### AC-1

**Given** missing exact-model approval, stale profile results or a required unknown/failure
**When** export is requested
**Then** no qualified package is emitted and the precise blocked state is shown; the blocked state is readable on phone and desktop

### AC-2

**Given** valid exact approval and all required checks passing
**When** export commits
**Then** 3MF, optional STL, PDF and structured provenance share the approved version and manifest-root lineage; the package files resolve through the Story 1.12 gateway for the owner (transfer and phone download states are Story 6.9)

### AC-3

**Given** repair history or personalization
**When** the package is inspected
**Then** every derivative, proof, warning, check and user-added detail remains represented without implying historical certainty or universal manufacturability

### AC-4

**Given** an export package that commits
**When** publication completes
**Then** one durable notification event is registered with Story 2.10 for the recipient, with the package as its authorized target

## Engineering Gates

G-3, G-4.

These are acceptance obligations, not claims that the implementation or qualification has passed.
