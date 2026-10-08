# Acceptance Criteria

**Story 4.7: Produce coarse and full GLB viewing derivatives**

**Epic 4: Generate and inspect traceable canonical geometry.** Approved evidence recipes produce immutable models whose features remain linked to evidence and inspectable without changing manufacturing authority.

As an Account owner,
I want to open a model quickly and see more detail as it loads,
So that inspection is fast without changing manufacturing geometry.

**Requirement IDs:** FR-18, AR-9, AR-24, NFR-10

## Dependencies

- [4.1](../spec-nova3D-story-4-1/SPEC.md)
- [4.5](../spec-nova3D-story-4-5/SPEC.md)

## Scope

- Generate from the canonical geometry a coarse GLB (at most 5 MB) and a full-detail GLB set (at most 20 MB in total) with explicit millimetre-to-metre and Z-up-to-Y-up transforms, semantic feature maps that do not depend on vertex or triangle order, and version-compatible bindings so selection can switch atomically; publish them through the Story 4.1 manifests.
- Derivatives are labeled preview and never manufacturing authority.

## Acceptance Criteria

### AC-1

**Given** a Model Version
**When** derivatives are produced
**Then** the coarse GLB of at most 5 MB and the full GLB set of at most 20 MB are published as manifests with transform metadata and semantic feature maps

### AC-2

**Given** a fixture of 100,000 preview triangles
**When** the derivatives are generated
**Then** every logical feature resolves through the feature map without triangle indices and the triangle budget holds

### AC-3

**Given** a preview derivative
**When** it is offered as manufacturing evidence
**Then** it is rejected and only canonical content qualifies

## Engineering Gates

G-5.

These are acceptance obligations, not claims that the implementation or qualification has passed.
