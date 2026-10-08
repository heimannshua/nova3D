# Acceptance Criteria

**Story 4.3: Certify corresponding geometry equivalence**

**Epic 4: Generate and inspect traceable canonical geometry.** Approved evidence recipes produce immutable models whose features remain linked to evidence and inspectable without changing manufacturing authority.

As an Account owner,
I want to verify that unchanged geometry stayed unchanged,
So that regeneration and minor repair cannot silently alter the model.

**Requirement IDs:** FR-16, FR-21, FR-26, AR-10, NFR-6

## Dependencies

- [4.2](../spec-nova3D-story-4-2/SPEC.md)

## Scope

- Implement a certified comparator and deliberate negative corpus independently of preview meshes.
- Tessellate the oriented, scaled solid at the print-frame deflection (0.002 mm linear, 0.1 rad angular) on both sides. The approximation bound is twice the deflection plus comparator and floating-point error; until G-2 verifies achieved deviation, use the larger of nominal and measured maximum deviation.
- Provide the pure print-frame function the comparator uses: the default orientation from the domain package's declared base face, and the largest uniform scale, never above 1:1, that fits the oriented solid's exact kernel bounding box (stored with the Model Version by Story 4.2) inside the profile cube minus 1 mm per side, as an exact rational. Use the R-3 profile constants as a pinned fixture until Story 6.1 pins profiles; Story 6.1 stores the result on the validation lineage, and Stories 4.4 and 5.2 reuse it.
- The comparator also compares two meshes directly, with a bound of comparator and floating-point error only (no deflection term).

## Acceptance Criteria

### AC-1

**Given** corresponding features under the print frame computed from the original version's solid (until Story 6.1 stores a lineage transform)
**When** comparison runs with the same tessellator/settings and error-bound version
**Then** feature identity, component count and closed-solid topology match; no best-fit or independent rescaling is used

### AC-2

**Given** certified surface-distance and volume calculations
**When** equivalence is decided
**Then** bidirectional distance upper bound and bounds delta are ≤0.01 mm and relative volume delta ≤0.1% using reference absolute volume

### AC-3

**Given** dimensional, thin-feature, hole, rotation, unit, scale or tiny/zero/ill-conditioned fixtures, or a uniform 0.1% shrink repair of a metre-scale source
**When** the regression corpus runs
**Then** inconclusive or violating results fail closed; coarse bounds/volume alone and preview LOD cannot certify equivalence

### AC-4

**Given** fixture solids
**When** the print-frame function runs
**Then** the scale never exceeds 1:1, keeps the oriented box inside the profile cube minus 1 mm per side, is an exact rational and is identical for identical inputs, a solid that cannot fit is rejected, and an axis-aligned alternative orientation is only proposed, never applied silently

## Engineering Gates

G-2.

These are acceptance obligations, not claims that the implementation or qualification has passed.
