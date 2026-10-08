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
- Expose the engine through a versioned engine port with a conformance test suite and a deterministic test engine, so Stories 7.2 to 7.5 can be built and accepted without qualified weights.
- The engine port also accepts optional explicit print constraints (failed check, measured value, required value, feature references) and stops with an actionable failure when it cannot satisfy them. The same pinned bundle runs in the browser worker and, for reconversion only, in the Railway engine worker (`workers/engine`); the conformance suite and the deterministic test engine run on both targets.
- Record the reference corpus, the shape and coverage metrics with their pass thresholds and the reviewer in the qualification report before any candidate run.

## Acceptance Criteria

### AC-1

**Given** a candidate model and held-out multi-view corpus
**When** license, shape/coverage and resource qualification runs
**Then** exact weights/runtime/digests and screening evidence on the hardware available indicate ≤500 MiB preparation download, ≤1 GiB working memory and ≤120 s local conversion, with qualifying proof on the adopted R-5 devices left to Story 8.6; the same weights are screened on the server target against the Spine default of 600 seconds and 8 GiB

### AC-2

**Given** no compliant candidate or missing device evidence
**When** readiness is evaluated
**Then** G-8 remains BLOCKED and the first-version scope/limits stay unchanged; backend identity-model success is not reconstruction success; Story 7.1 completes with that recorded BLOCKED report and the G-8 product-decision checkpoint opens

### AC-3

**Given** WebGPU/WASM execution, eviction or interruption
**When** the candidate is exercised
**Then** documented supported behavior preserves privacy and recovery without silently substituting cloud inference

### AC-4

**Given** Story 7.1 has completed with a recorded BLOCKED report
**When** Stories 7.2 to 7.5, 7.8 and 7.9 are built
**Then** they run against the engine port using only the test engine, label every output non-qualified, never offer it to users as reconstruction, and cannot close G-8

## Engineering Gates

G-8.

These are acceptance obligations, not claims that the implementation or qualification has passed.
