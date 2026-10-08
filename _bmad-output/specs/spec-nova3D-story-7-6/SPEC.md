---
id: SPEC-nova3D-story-7-6
status: final
companions:
- acceptance-criteria.md
- implementation-constraints.md
- ../spec-nova3D/SPEC.md
sources:
- ../../planning-artifacts/story-inputs/story-7-6.json
---

# Story 7.6: Qualify direct models through the shared lineage

## Why

An Account owner needs to validate and export an image-derived model. Direct mode receives the same model and print gates.

## Capabilities

- **CAP-1**
  - **intent:** Export direct models only through trusted online approval and validation.
  - **success:** Given a synchronized direct candidate, when qualified export is requested, then connection, trusted exact-model approval and all required profile checks are enforced; local labels or approvals do not establish server authority; the export request and its blocked states work on phone and desktop.

- **CAP-2**
  - **intent:** Require a confirmed real-world dimension before print scale or qualified export of a direct model.
  - **success:** Given a synchronized direct candidate with no confirmed real-world dimension, when print scale or export is requested, then qualified export stays blocked until the user confirms a dimension, after which the lineage print scale and default orientation apply and the model keeps its honest image-derived provenance.

- **CAP-3**
  - **intent:** Present direct-mode provenance in the envelope and PDF Source Record.
  - **success:** Given a synchronized direct candidate being exported, when the provenance envelope and PDF Source Record are produced, then the Evidence group states image-derived provenance with input image digests, engine bundle and settings, confirmed scope and the uncertainty acknowledgment, contains no historical claim, and the PDF and envelope agree.

- **CAP-4**
  - **intent:** Apply the shared repair classes to direct candidates.
  - **success:** Given a synchronized direct candidate that fails structural validation, when local repair is attempted, then the Story 6.4 classes apply unchanged: a nonconsequential repair keeps the version only with the equivalence proof, a consequential one creates a successor needing re-inspection and approval, and reconversion is Story 7.8.

All [acceptance criteria](acceptance-criteria.md) apply to the complete story.

## Constraints

- This story implements the declared slice after its listed dependencies; it does not absorb unrelated parent capabilities.
- The [implementation constraints](implementation-constraints.md) and recursively adopted parent contract are mandatory, including ratified overrides to older source wording.
- Existing product decisions remain binding. Spec completion does not establish implementation, device support or engineering-gate acceptance.

## Non-goals

- Implementing unassigned later-story behavior or creating all future domain entities in advance.
- Adding manual mesh editing, public registration, printer control or commercial storefront behavior.

## Success signal

Connection, trusted exact-model approval and all required profile checks are enforced; local labels or approvals do not establish server authority; the export request and its blocked states work on phone and desktop. The exact criteria demonstrate the complete story outcome and its failure boundaries; any gate-status change requires actual qualification evidence.

## Assumptions

- Story boundaries and ordering are delegated fast-path planning choices; they do not claim separate user approval. Detailed shared assumptions remain in the constraints companion.
