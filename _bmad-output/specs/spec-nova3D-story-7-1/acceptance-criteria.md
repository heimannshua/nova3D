# Acceptance Criteria

**Story 7.1: Qualify a bounded multi-view reconstruction engine**

**Epic 7: Create direct models offline and synchronize safely.** Prepared supported devices can create honestly labeled image-derived models offline, preserve them locally and synchronize without privacy or history loss.

As a maintainer,
I want to have a viable on-device conversion engine,
So that offline creation can meet the adopted device limits.

**Requirement IDs:** AR-22, AR-24, AR-27, NFR-10, SC-1, SC-2

## Dependencies

- [2.3](../spec-nova3D-story-2-3/SPEC.md)
- [4.1](../spec-nova3D-story-4-1/SPEC.md)

## Scope

- Select/adapt licensed pinned weights with ONNX Runtime Web 1.29.0 as the first browser backend; no engine is currently qualified.

## Acceptance Criteria

### AC-1

**Given** a candidate model and held-out multi-view corpus
**When** license, shape/coverage and resource qualification runs
**Then** exact weights/runtime/digests and evidence establish ≤500 MiB preparation download, ≤1 GiB working memory and ≤120 s local conversion on the adopted R-5 devices

### AC-2

**Given** no compliant candidate or missing device evidence
**When** readiness is evaluated
**Then** G-8 remains BLOCKED and the first-version scope/limits stay unchanged; backend identity-model success is not reconstruction success

### AC-3

**Given** WebGPU/WASM execution, eviction or interruption
**When** the candidate is exercised
**Then** documented supported behavior preserves privacy and recovery without silently substituting cloud inference

## Engineering Gates

G-8.

These are acceptance obligations, not claims that the implementation or qualification has passed.
