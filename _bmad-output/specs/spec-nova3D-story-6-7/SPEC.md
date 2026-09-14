---
id: SPEC-nova3D-story-6-7
status: final
companions:
- acceptance-criteria.md
- implementation-constraints.md
- ../spec-nova3D/SPEC.md
sources:
- ../../planning-artifacts/story-inputs/story-6-7.json
---

# Story 6.7: Render a readable bilingual PDF Source Record

## Why

An Account owner needs to read the provenance outside the app. The exported explanation remains legible and linked.

## Capabilities

- **CAP-1**
  - **intent:** Read bilingual provenance in a linked PDF.
  - **success:** Given one validated immutable export envelope, when the PDF is rendered, then Hebrew original and English translation/explanation have readable glyphs, correct order, pagination and reciprocal stable links.

- **CAP-2**
  - **intent:** Render untrusted source content without executing active or remote content.
  - **success:** Given untrusted source text or embedded script/remote-resource references, when rendering executes, then content is escaped and remote resources/scripts cannot run.

- **CAP-3**
  - **intent:** Keep the PDF and structured provenance consistent with the immutable export.
  - **success:** Given the same package record, when PDF and structured provenance are compared, then model, approvals, profile, validation, repairs and personal additions agree; no external refresh changes the source record.

All [acceptance criteria](acceptance-criteria.md) apply to the complete story.

## Constraints

- This story implements the declared slice after its listed dependencies; it does not absorb unrelated parent capabilities.
- The [implementation constraints](implementation-constraints.md) and recursively adopted parent contract are mandatory, including ratified overrides to older source wording.
- Existing product decisions remain binding. Spec completion does not establish implementation, device support or engineering-gate acceptance.

## Non-goals

- Implementing unassigned later-story behavior or creating all future domain entities in advance.
- Adding manual mesh editing, public registration, printer control or commercial storefront behavior.

## Success signal

Hebrew original and English translation/explanation have readable glyphs, correct order, pagination and reciprocal stable links. The exact criteria demonstrate the complete story outcome and its failure boundaries; any gate-status change requires actual qualification evidence.

## Assumptions

- Story boundaries and ordering are delegated fast-path planning choices; they do not claim separate user approval. Detailed shared assumptions remain in the constraints companion.
