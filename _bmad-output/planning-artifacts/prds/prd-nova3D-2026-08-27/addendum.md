# PRD Addendum: Technical Context and Deferred Decisions

## Intended Platform Choices

The approved product direction intends to use React and Tailwind for the browser experience, Vercel for deployment, Supabase for persistent Project, evidence, approval, and Version data, Upstash where queued background work is justified, and GitHub for source control. These are constraints for architecture to evaluate, not product behavior. Each service should be used only where it fits the required capability.

## Current Technical Benchmarks

- W3C PROV provides a useful conceptual model for entities, activities, agents, derivations, responsibility, and timestamps in the evidence chain: [PROV-DM](https://www.w3.org/TR/prov-dm/).
- NIST's Generative AI risk profile reinforces explicit human oversight, documented knowledge limits, citation verification, and provenance: [NIST AI 600-1](https://nvlpubs.nist.gov/nistpubs/ai/NIST.AI.600-1.pdf).
- Code-parametric systems such as [CadQuery](https://cadquery.readthedocs.io/en/latest/importexport.html) and [Zoo KCL](https://zoo.dev/docs/kcl) demonstrate canonical editable representations and deterministic exports. Generic systems that generate meshes remain probabilistic and are not suitable as the authoritative evidence-to-geometry representation.
- [Onshape](https://cad.onshape.com/help/Content/Document/versions_and_history.htm) provides useful interaction benchmarks for measurement, sectioning, immutable Versions, and graphical comparison in a browser.
- The [3MF Core Specification](https://github.com/3MFConsortium/spec_core/blob/master/3MF%20Core%20Specification.md) and [lib3mf](https://github.com/3MFConsortium/lib3mf) provide current references for explicit units, manifold geometry, orientation, and format validation. The MVP uses 3MF as the primary print format, offers STL as an optional compatibility copy, and delivers a readable PDF Source Record.
- [OctoPrint's REST API](https://docs.octoprint.org/en/main/api/index.html) demonstrates later authenticated printer upload, job control, status, and permission behavior. Printer integration remains outside the MVP.

## Architecture Decisions Deferred

- Authoritative source acquisition, extraction, citation verification, and source identity.
- Data model for Sources, Claims, Consequential Details, Defensible Options, approvals, parameters, dependencies, Model Features, Versions, and cached research.
- Canonical geometry representation and browser-versus-server execution boundary.
- Reproducibility equivalence method and tolerances.
- Viewer representation, performance degradation, and WebGL or GPU failure recovery.
- Target Print Profile schema, supported validation checks, and repair operations.
- Background Job orchestration, cancellation semantics, stale-result protection, idempotency, and cost reconciliation.
- Authentication, Administrator recovery, Account isolation, deletion, backup retention, and privacy-preserving cache enforcement.
- Notification persistence and delivery beyond the in-app bar.

## Deferred Product Capabilities

The approved expansion order is:

1. Expand the evidence and geometry system from the altar and ramp to the complete Temple and utensils.
2. Add direct printer control, then multi-printer queues, device and filament state, explainable routing, settings, and cameras.
3. Generalize the engine to other books, research subjects, and model types through reusable domain packages rather than Temple-specific logic spread across the system.
4. Validate repeatable quality across multiple outputs before commercial sale.

Direct picture-to-model and research-assisted picture reconstruction are also deferred until the text-led workflow is reliable. Direct conversions must be labelled as image-derived, not as historically verified.

Later printer integration must keep upload, selection, and print start as separately gated actions; require explicit final confirmation; expose live state, progress, errors, pause, and cancellation; prevent duplicate starts; and preserve an audit record without altering the approved evidence-to-geometry lineage.
