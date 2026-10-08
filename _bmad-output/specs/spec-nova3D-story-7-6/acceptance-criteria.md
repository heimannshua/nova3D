# Acceptance Criteria

**Story 7.6: Qualify direct models through the shared lineage**

**Epic 7: Create direct models offline and synchronize safely.** Prepared supported devices can create honestly labeled image-derived models offline, preserve them locally and synchronize without privacy or history loss.

As an Account owner,
I want to validate and export an image-derived model,
So that direct mode receives the same model and print gates.

**Requirement IDs:** FR-23, FR-24, FR-25, FR-26, FR-27, FR-29, AR-4, AR-13, AR-22, SC-1, SC-2, UX-DR17, UX-DR57, UX-DR62, UX-DR63

## Dependencies

- [7.3](../spec-nova3D-story-7-3/SPEC.md)
- [7.5](../spec-nova3D-story-7-5/SPEC.md)
- [6.5](../spec-nova3D-story-6-5/SPEC.md)
- [6.9](../spec-nova3D-story-6-9/SPEC.md)

## Scope

- Integrate direct snapshots with online exact-model approval and print validation, including the user-confirmed real-world dimension that sets the print scale.

## Acceptance Criteria

### AC-1

**Given** a synchronized direct candidate
**When** qualified export is requested
**Then** connection, trusted exact-model approval and all required profile checks are enforced; local labels or approvals do not establish server authority; the export request and its blocked states work on phone and desktop

### AC-2

**Given** a synchronized direct candidate with no confirmed real-world dimension
**When** print scale or export is requested
**Then** qualified export stays blocked until the user confirms a dimension, after which the lineage print scale and default orientation apply and the model keeps its honest image-derived provenance

### AC-3

**Given** a synchronized direct candidate being exported
**When** the provenance envelope and PDF Source Record are produced
**Then** the Evidence group states image-derived provenance with input image digests, engine bundle and settings, confirmed scope and the uncertainty acknowledgment, contains no historical claim, and the PDF and envelope agree

### AC-4

**Given** a synchronized direct candidate that fails structural validation
**When** local repair is attempted
**Then** the Story 6.4 classes apply with the mesh-to-mesh comparison of Story 6.10: a nonconsequential repair keeps the version only with the equivalence proof, a consequential one creates a successor needing re-inspection and approval, and reconversion is Story 7.8

## Engineering Gates

G-3, G-8.

These are acceptance obligations, not claims that the implementation or qualification has passed.
