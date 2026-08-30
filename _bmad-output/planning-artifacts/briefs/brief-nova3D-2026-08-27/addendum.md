# Product Brief Addendum: Feasibility and Parked Detail

## Current Feasibility Snapshot

The individual capabilities required by nova3D are available today, but the governed integration is the difficult product work.

- Source-grounded research systems can work with uploaded material, web sources, and citations, but their providers warn that factual errors, weak source ranking, and miscalibrated confidence remain possible. Human review is therefore a product requirement, not temporary scaffolding. See [OpenAI Deep Research](https://help.openai.com/en/articles/10500283) and its [launch limitations](https://openai.com/index/introducing-deep-research/).
- Cultural-heritage tools already support provenance-rich annotation and scholarly context. Relevant reference points include [Recogito](https://recogito.pelagios.org/), [ResearchSpace](https://researchspace.org/), and the Smithsonian's [Voyager](https://smithsonian.github.io/dpo-voyager/).
- Deterministic parametric solids and printable exports are practical through systems such as [CadQuery](https://cadquery.readthedocs.io/_/downloads/en/latest/pdf/). Browser-side manifold geometry is possible with [Manifold WebAssembly](https://github.com/elalish/manifold/blob/master/bindings/wasm/README.md), and browser-based preview and export are mature in [Three.js](https://threejs.org/docs/).
- Generic text-to-3D and image-to-3D services produce inferred polygonal assets, not evidence-traceable parametric reconstructions. They may help with non-authoritative hypotheses or ornament studies but should not be the governing geometry path.
- Printer dispatch and control are feasible for known endpoints through systems such as the [OctoPrint REST API](https://docs.octoprint.org/en/main/api/index.html). Safe scheduling across multiple heterogeneous printers remains a distinct later product problem.

## Technical Decisions Deferred Beyond the Brief

The PRD and architecture work must resolve:

- The authoritative edition, translation, and passage structure for Middot.
- The source ingestion, retrieval, citation-verification, and confidence model.
- The schema linking passages, claims, alternatives, approvals, typed parameters, dependencies, geometry features, and versions.
- The deterministic geometry engine and boundary between browser and server execution.
- The print-ready export format and the exact checks for manifold geometry, wall thickness, clearance, scale, and slicing.
- How personalization requests are constrained and visually distinguished from reconstruction geometry.
- Version comparison, restoration, and provenance retention.

## Parked Product Direction

The longer-term printer layer should connect to multiple personal printers across brands and protocols, integrate slicers, and handle authentication. It should track each device's state, capabilities, and loaded filament type and colour; avoid interrupting active jobs; queue work safely; choose the best-suited printer; provide configuration settings; and show camera feeds. It is intentionally excluded from the first milestone.

Commercial sale is an outcome of proven reliability, not a first-release workflow. nova3D will retain source citations but will not determine whether source material may legally be reused in a commercial model; the licensing review remains the user's responsibility.
