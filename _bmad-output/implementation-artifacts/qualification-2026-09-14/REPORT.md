# nova3D architecture qualification — 2026-09-14

**Outcome: local component feasibility is evidenced; application acceptance and release remain open.** Four Omnigent MCP sessions running `gpt-5.6-luna` executed the probes; a fifth Luna session independently reviewed their code and claims. [Session metadata](MCP-SESSIONS.json) records the requested and observed model. Josh's ratified R-1–R-11 remain binding.

This checkout contains planning artifacts and isolated qualification programs, not the nova3D application. Every geometry, account, job and stored object used here is synthetic. The run used Linux containers and headless Chrome on the development host; no target phone, physical printer, cloud deployment, credentials or paid application-provider calls were used.

## Executed evidence

| Area | Local result | What the run actually establishes | Acceptance boundary |
| --- | --- | --- | --- |
| [Web stack](stack/qualification-report.md) | **PASS** | Exact Node 24.21.0, Next 16.3.5, React/DOM 19.3.0, TypeScript 5.9.3 and Tailwind 4.3.3; Supabase/SSR and Upstash imports; production builds with Turbopack and Webpack; loopback production HTTP responses. | No Supabase authentication/RLS, Upstash dispatch, deployment or cross-provider execution. |
| [Native CAD](feasibility/qualification-report.md) | **PASS — synthetic fixture** | CadQuery 2.8.0/Python 3.12.14 native generation, user-added plaque, controlled correction, STEP/BREP restore, coarse repeatability and process cancellation in a bounded container. | Synthetic altar/ramp only. Topology counts, bounds and volume do not certify R-2 surface distance or historical correctness. Docker-client RSS is not worker peak memory. |
| [Browser/storage/runtime](devices/qualification-report.md) | **PASS — headless Linux** | WebGL2, optional software WebGPU, Worker, Service Worker offline navigation, original IndexedDB/OPFS byte retention, Three fixture and an ONNX WASM identity model. | Phone viewport emulation is not device qualification. Offline model/runtime assets were not cached; offline inference and viewer timing were not run. |
| [Print software](print/REPORT.md) | **PASS — bounded fixtures and one slice** | Pinned manufacturer profile inheritance; explicit three-perimeter override; mesh/threshold fixtures; STL/3MF round-trip; actual BambuStudio 02.08.02.61 slice producing G-code and 3MF for a 40 mm box at 0.2 mm layers. | Fixture-specific checks do not implement general wall/clearance/relief/support analysis, certified repair equivalence or approval/reconversion flows. No physical print was attempted. |
| [Recovery and concurrency](recovery/recovery-report.md) | **PASS — local prototype** | Postgres dump/restore plus independent object backup; durable deletion intent and replay after restore; survivor byte digest; post-deletion update rejection; unique regeneration slot, import idempotency and integer budget races. | Synthetic SQL/local files only. No live authorization fencing, production Manufacturing/Usage services, cloud retention, backup-expiry or RPO/RTO evidence. |
| [Offline reconstruction candidates](devices/qualification-report.md#image-to-3d-engine-feasibility-review) | **BLOCKED** | Official source/model-card review of TripoSR, InstantMesh, TRELLIS-image-large and Hunyuan3D-2/2mv found no qualifying candidate for the adopted multi-view, ≤500 MiB bundle, ≤1 GiB memory, ≤120 s phone target. | This is a review of four published candidates, not a proof that the target is impossible. No reconstruction weights were executed or selected. |

The early Next `Expected workStore to be initialized` failures are preserved in the stack report. They occurred in manually staged dependency layouts and did not reproduce in clean projects with the same exact versions. The clean result resolves the observed compatibility concern without changing the stack; it does not establish a unique root cause for the failed layouts.

The first BambuStudio launch failed for missing Linux runtime libraries. Installing the needed libraries inside a disposable container enabled the same pinned binary to slice successfully. The initial failures remain part of the evidence trail.

## Current engineering gates

“PARTIAL” means relevant local evidence exists and the complete gate remains open. “BLOCKED” identifies a missing implementation, model or target environment needed for acceptance. “NOT RUN” identifies checks outside this execution scope. None of these labels substitutes for a full application gate PASS.

| Gate | Status | Evidence now available | Evidence still required |
| --- | --- | --- | --- |
| G-1 — Canonical worker | **PARTIAL** | Native toolchain, synthetic generation/personalization/correction/restore and bounded cancellation. | Approved evidence-backed altar/ramp corpus; application recipe/version integration; deployed worker resources, fencing and restore behavior. |
| G-2 — Geometry equivalence | **PARTIAL** | Coarse repeated/serialized geometry comparisons and deliberate dimensional, thin-feature, hole, scale and unit negatives. | Certified bidirectional surface-distance upper bound ≤0.01 mm; corresponding features under the pinned final-print transform; rotations, tiny/ill-conditioned features and repair corpus. |
| G-3 — Print qualification | **PARTIAL** | Profile closure and override, independent fixtures, one successful official-slicer run; SQL unique-slot primitive from recovery. | General required geometric/support checks that fail closed on unknown; consequential/nonconsequential repair handling; successor Job/outbox/lineage atomicity, retry and renewed approval. Physical printing is a separate unverified claim and is not required for the adopted altar/ramp demonstration. |
| G-4 — Provenance/export | **NOT RUN** | No qualifying schema/PDF/export-package run. | Cross-runtime schema, reciprocal feature/evidence links and readable Hebrew/English PDF from the same immutable export. |
| G-5 — Supported devices | **BLOCKED** | Headless Linux API/storage/fixture feasibility. | Real MacBook Air M2, Windows/Iris Xe, iPhone 16 Pro and Pixel 9 Pro browser matrix; full workflow accessibility; progressive semantic viewer and ≤5 s/≤33 ms timing; GPU-loss recovery. |
| G-6 — Paid-operation control | **PARTIAL** | Synthetic integer/rational arithmetic and concurrent Account/parent-Job ceilings. | Actual account terms/rates and permission/disclosure; bounded request calculator, ambiguous-charge settlement/reconciliation, cancellation and authenticated application enforcement. |
| G-7 — Evidence rights | **NOT RUN** | No edition-ingestion or retention-path qualification. | Pinned edition rights, inspectable source records and permitted private/shared retention. |
| G-8 — Offline conversion/sync | **BLOCKED** | Storage/API/runtime primitives and import deduplication prototype; four candidate source reviews. | A compliant pinned reconstruction model; offline bundle preparation and execution on real devices; quality/coverage, eviction/interruption, authoritative reconnect revocation and conflict sync. |
| G-9 — Recovery/deletion | **PARTIAL** | Local Postgres/object restore with intervening deletion and external ledger replay. | Provisioned provider plans/regions, private-file and callback path, full app deletion/fencing, active purge ≤24 h, controlled backup expiry ≤30 d and measured RPO/RTO ≤24 h. |

## Reproduction and review

Start with [the probe guide](../../../tools/qualification/README.md). Each area report links its executable source, exact inputs, version records and raw results. Dependencies, images and large third-party executables are held in the isolated cache; small synthetic outputs and source-profile license metadata are retained here. Rebuilds may need network access to the recorded official package registries and images.

[Parent checks](PARENT-CHECKS.json) record independent reruns and their precise scope. [Independent review](BLIND-REVIEW.md) and [review disposition](REVIEW-DISPOSITION.md) document evidence-quality corrections. [SHA256SUMS](SHA256SUMS) binds the retained probes, reports and outputs after final verification.

## Implementation consequences

The selected web stack and native CAD worker have a usable local baseline. Implement the canonical geometry and approval path with G-2's certified comparator and G-3's fail-closed validator before treating a generated model as a qualified export. The demonstrated SQL operations are reference probes, not production migrations or authorization implementations.

G-8 is the largest unresolved feasibility dependency for the complete first version. Continue model selection/adaptation under the adopted phone/offline limits, then qualify actual devices. A proposal to change those limits or remove offline/multi-view scope needs a recorded product decision. This run neither changes that scope nor grants release acceptance.

