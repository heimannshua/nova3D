# Acceptance Criteria

**Story 6.7: Render a readable bilingual PDF Source Record**

**Epic 6: Qualify and export an evidence-backed printable model.** An approved model can pass exact profile checks, receive bounded audited repair and be downloaded with immutable bilingual provenance.

As an Account owner,
I want to read the provenance outside the app,
So that the exported explanation remains legible and linked.

**Requirement IDs:** FR-29, AR-13, NFR-2, NFR-3, UX-DR5, UX-DR63

## Dependencies

- [6.6](../spec-nova3D-story-6-6/SPEC.md)

## Scope

- Render the shared immutable provenance using pinned container Playwright/Chromium and licensed Noto fonts with no external resources.

## Acceptance Criteria

### AC-1

**Given** one validated immutable export envelope
**When** the PDF is rendered
**Then** Hebrew original and English translation/explanation have readable glyphs, correct order, pagination and reciprocal stable links

### AC-2

**Given** untrusted source text or embedded script/remote-resource references
**When** rendering executes
**Then** content is escaped and remote resources/scripts cannot run

### AC-3

**Given** the same package record
**When** PDF and structured provenance are compared
**Then** model, approvals, profile, validation, repairs and personal additions agree; no external refresh changes the source record

## Engineering Gates

G-4.

These are acceptance obligations, not claims that the implementation or qualification has passed.
