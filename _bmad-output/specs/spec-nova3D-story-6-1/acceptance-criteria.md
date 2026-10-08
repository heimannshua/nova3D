# Acceptance Criteria

**Story 6.1: Pin the exact target print profile**

**Epic 6: Qualify and export an evidence-backed printable model.** An approved model can pass exact profile checks, receive bounded audited repair and be downloaded with immutable bilingual provenance.

As an Account owner,
I want to select printer, material and final physical size,
So that validation applies to the intended output.

**Requirement IDs:** FR-24, AR-9, AR-11, NFR-11, UX-DR17, UX-DR58

## Dependencies

- [5.5](../spec-nova3D-story-5-5/SPEC.md)
- [4.3](../spec-nova3D-story-4-3/SPEC.md)

## Scope

- Pin the complete manufacturer profile inheritance plus explicit application overrides and print transform.
- Compute the default print scale once per validation lineage when the user first pins a profile for a root Model Version (the command of this story, before any validation) with the Story 4.3 print-frame function applied to the box stored by Story 4.2 (largest uniform scale, never above 1:1, that fits the oriented canonical solid's exact kernel bounding box inside the profile cube minus 1 mm per side, stored as an exact rational), and create the Manufacturing validation lineage record: lineage ID, root Model Version, profile revision, scale, orientation and the single full_regeneration slot, which every repair and regeneration child inherits unchanged. Default the orientation to the domain package's declared base face on the plate, Z-up. An image-derived model has no print scale until the user confirms a real-world dimension, and its default orientation is the largest planar face, user-confirmed. This story owns the dimension-confirmation step: the user confirms one real-world dimension of the confirmed scope against a reference axis (the longest axis of the mesh's bounding box in the confirmed print orientation (the axis-aligned box after the orientation is applied) unless another is picked), stored as an immutable Geometry-owned confirmation. Calibration is the confirmed millimetres divided by that axis length in snapshot units, and the fit step then gives the largest scale not above 1:1 that fits the calibrated box in the profile cube; the lineage inherits the confirmed value and axis rule, and each snapshot's calibration is computed once. The default orientation is the largest planar face (a connected group of triangles whose normals stay within 2 degrees of the group's area-weighted mean normal and that holds at least 5% of the surface area), user-confirmed; with none, the user picks one of three axis-aligned orientations. A correction or restore successor is a new root with its own lineage.
- Offer a smaller print scale (never above the profile) as a choice at the pin, which creates a new validation identity inside the lineage.

## Acceptance Criteria

### AC-1

**Given** the initial profile
**When** it is selected
**Then** A1 mini 0.4 mm, Bambu PLA Silk+ Gold, ≤90 mm cube, 0.20 mm layers and explicit three perimeters resolve from the pinned inheritance closure; selection works on phone and desktop

### AC-2

**Given** profile, scale or orientation changes
**When** validation identity is computed
**Then** a new revision makes incompatible prior results stale, a user-chosen smaller scale is a new validation identity inside the same lineage that cannot rearm its regeneration slot, and a successor that no longer fits fails validation instead of being rescaled

### AC-3

**Given** an incomplete or unknown profile
**When** qualification is requested
**Then** missing fields are visible and qualified export is blocked without a universal safety claim

### AC-4

**Given** a Model Version's first profile pin
**When** the lineage is created
**Then** the record holds the root Model Version, profile revision, exact-rational scale, orientation and an unconsumed full_regeneration slot, and a repair child or regenerated successor inherits it unchanged

### AC-5

**Given** an image-derived model (a fixture mesh until Story 7.4 imports real ones) with no confirmed dimension
**When** a profile pin is requested
**Then** no scale or lineage is created and the dimension prompt is shown; after confirmation the scale follows the confirmed dimension and the orientation is the user-confirmed largest planar face

### AC-6

**Given** a domain-declared base face
**When** the default orientation is set
**Then** the base face lies on the plate, Z-up, with no rotation about Z, and an axis-aligned alternative is only proposed, never applied silently

## Engineering Gates

G-3.

These are acceptance obligations, not claims that the implementation or qualification has passed.
