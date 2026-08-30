# Reconciliation: Product Brief Addendum to PRD

## Sources Compared

- Input: `briefs/brief-nova3D-2026-08-27/addendum.md`
- Current product contract: `prds/prd-nova3D-2026-08-27/prd.md`
- Current technical/deferred context: `prds/prd-nova3D-2026-08-27/addendum.md`

## Reconciliation Verdict

The PRD preserves the brief addendum's central feasibility judgment: the component technologies are available, but trustworthy integration, human oversight, provenance, deterministic geometry, print qualification, and bounded automation are the product work. It also preserves the two-approval flow, the exclusion of probabilistic meshes from the authoritative geometry path, the MVP boundary around printer control, and the user's responsibility for commercial source licensing.

The transfer is incomplete in ten places. Eight affect the MVP's decision or acceptance surface; two weaken the parked post-MVP direction. They should be restored as requirements, open questions, or explicitly retained deferred decisions rather than being inferred from broad wording.

## Gaps and Weakened Transfers

### 1. The authoritative Middot text basis is missing

- **Source intent:** The PRD/architecture phase must choose the authoritative edition, translation, and passage structure for Middot.
- **Current state:** FR-8 requires identification of relevant material in Middot and permits wider research, but neither the PRD open questions nor its addendum requires selection and versioning of the governing edition, translation, or passage segmentation.
- **Why this matters:** Different editions, translations, or passage boundaries can produce different Claims and dimensions while still satisfying the generic requirement to cite a source.
- **Reconciliation needed:** Add a deferred decision that identifies the authoritative text basis, records alternate editions/translations as evidence, and binds extracted Claims to stable passage identifiers and the exact source version used.

### 2. Citation verification is deferred technically but not made a product gate

- **Source intent:** Source-grounded systems can still produce factual errors; human review is a permanent product requirement. The source-ingestion design must resolve citation verification.
- **Current state:** FR-9 requires source identity and inspectable location context, and FR-13 requires Plan Approval. The PRD addendum names citation verification as an architecture decision. None of these states what makes a citation verified or prevents a Research Plan from becoming approvable when a citation exists but does not support its Claim.
- **Why this matters:** Provenance can be complete in form while incorrect in substance. Human approval is less useful if the interface cannot expose unsupported, mismatched, or inaccessible citations.
- **Reconciliation needed:** Define a citation-support verification state and its effect on Plan readiness, including handling for inaccessible sources, location mismatches, weak entailment, and verification that remains unresolved for human judgment. Keep Plan Approval as human oversight rather than treating verification automation as a substitute.

### 3. Source ranking and conflict resolution remain under-specified

- **Source intent:** Provider limitations include weak source ranking, so source authority is part of the governed integration problem.
- **Current state:** FR-9 distinguishes leads from recommended evidence and names broad acceptable source categories. It does not define how authority is established within those categories, how conflicting authorities are compared, or when a low-authority lead may contribute to a Defensible Option.
- **Why this matters:** Two plans can comply with FR-9 while ranking the same conflicting evidence differently and presenting incompatible recommendations.
- **Reconciliation needed:** Retain an explicit architecture/product decision for authority metadata, ranking criteria, conflict handling, and the visible explanation of why one source influenced a recommendation more than another.

### 4. The confidence model has been reduced to a presentation rule

- **Source intent:** The PRD/architecture phase must resolve the confidence model, while guarding against miscalibrated confidence.
- **Current state:** FR-11 correctly says confidence must be explained through evidence and reasoning rather than only an opaque score. The PRD addendum does not retain a decision for how confidence is represented, derived, calibrated, revised, or compared across Claims and Consequential Details.
- **Why this matters:** An explanation can still carry an unjustified confidence label, and different research runs can assign inconsistent confidence without violating the current wording.
- **Reconciliation needed:** Add a deferred confidence-model decision covering allowed representations, evidence-to-confidence rules, calibration or validation, propagation from Claims to details, and treatment of disagreement and unknowns. It must not collapse `Detail Status` into a numeric score.

### 5. Personalization request constraints are absent

- **Source intent:** Architecture/product design must decide how Personalization requests are constrained.
- **Current state:** FR-17 labels Personalization as user-added and sends it through inspection, versioning, approval, and print validation. It does not specify what requests are disallowed, whether Personalization may alter evidence-backed geometry, or what happens when it conflicts with historical dimensions, dependencies, or print constraints.
- **Why this matters:** A natural-language Personalization request could silently modify the reconstruction and blur which geometry remains evidence-backed.
- **Reconciliation needed:** Add a Personalization boundary policy: allowed operations and attachment regions, prohibited mutation of reconstruction parameters unless explicitly reclassified, collision/dependency handling, and a clear refusal or confirmation path for requests that cross the boundary.

### 6. Visual distinction was weakened to visible classification

- **Source intent:** Personalization should be visually distinguished from reconstruction geometry.
- **Current state:** FR-17 requires every personalized Model Feature to be "visibly classified as user-added." That can be satisfied by a badge or metadata panel without distinguishing the geometry in the viewer.
- **Why this matters:** During inspection, users may mistake user-added geometry for a sourced historical feature even though the metadata is technically available.
- **Reconciliation needed:** Require a persistent, accessible viewer treatment for user-added geometry, with a legend and a non-colour-only distinction, while preserving the classification in the Source Record and exported provenance.

### 7. Version comparison is not an implemented capability

- **Source intent:** Version comparison, restoration, and provenance retention are all deferred decisions to resolve. Onshape is cited in the PRD addendum as a graphical-comparison benchmark.
- **Current state:** FR-22 supports viewing and restoring prior Versions, and the user journey says the user can compare outcomes. No functional requirement defines comparison of two Versions or the geometry, parameter, interpretation, evidence, validation, and Personalization differences to show.
- **Why this matters:** A user can restore Versions but cannot reliably understand what changed before choosing between them or granting Model Approval.
- **Reconciliation needed:** Add a Version-comparison requirement and defer the exact visualization method. At minimum, the comparison should expose changed Model Features and their governing decision, parameter, provenance, validation, and approval differences.

### 8. Slicing is missing from print-readiness decisions and qualification language

- **Source intent:** The print-ready path must resolve exact checks for manifold geometry, wall thickness, clearance, scale, and slicing.
- **Current state:** FR-24 through FR-29 cover units, manifoldness, orientation, volume, walls/features, clearances, build envelope, and supported orientation/support constraints. Neither the PRD nor its addendum decides whether an actual slicer participates, which slice checks are blocking, or whether an Export can be called print-ready without successful slicing.
- **Why this matters:** Geometry can pass mesh checks yet fail or behave unexpectedly in the target slicer. The current wording can overstate qualification if slicing is outside the MVP pipeline.
- **Reconciliation needed:** Add an open decision for slicer integration and slice-derived acceptance checks. If slicing is deferred, state that boundary explicitly and narrow "print-ready"/"passing validation" claims to the checks actually performed.

### 9. The parked printer layer lost compatibility and authentication constraints

- **Source intent:** The later printer layer should span brands and protocols, integrate slicers, and handle authentication.
- **Current state:** The PRD addendum retains direct printer control, multi-printer queues, device state, routing, settings, and cameras, but omits cross-brand/protocol compatibility, slicer integration, and authentication from the parked capability statement. OctoPrint remains only a benchmark.
- **Why this matters:** Future architecture could interpret the direction as a single-vendor adapter or unauthenticated local control surface and still match the abbreviated text.
- **Reconciliation needed:** Restore these as parked product constraints, without moving them into the MVP: heterogeneous adapters, authenticated endpoints, explicit permission behavior, and slicer integration.

### 10. The parked printer layer lost its non-interruption safety invariant

- **Source intent:** Later scheduling must inspect printer state and capabilities, including loaded filament type and colour, avoid interrupting active jobs, queue safely, and choose the best-suited device. Safe heterogeneous scheduling is a distinct later product problem.
- **Current state:** "Multi-printer queues, device and filament state, explainable routing" retains much of the direction but does not preserve the explicit rule against interrupting active work or say that stale/unknown device and material state must block automatic dispatch.
- **Why this matters:** A future implementation could optimize routing while pre-empting a live job or dispatching against stale capability/material data.
- **Reconciliation needed:** Record the future invariant that nova3D never interrupts an active printer job and does not auto-dispatch when endpoint, capability, or loaded-material state is missing or stale. Keep the exact scheduling policy deferred.

## Preserved Without Material Loss

- **Human oversight:** The source caution is strongly embodied in complete Research Plan review, version-bound Plan Approval, inspection, and version-bound Model Approval. It is product behavior rather than temporary scaffolding.
- **Evidence status and historical uncertainty:** FR-10 through FR-13 prevent silent invention and require sourced, inferred, disputed, unknown, or user-added status.
- **Provenance schema scope:** The PRD glossary, functional requirements, NFR-3, and technical addendum retain the essential relationships among Sources, Claims, alternatives, approvals, parameters, dependencies, Model Features, and Versions.
- **Deterministic governing geometry:** FR-15 and FR-16, NFR-6, and the PRD addendum retain a reproducible canonical representation and exclude probabilistic generative meshes as the authority path.
- **Browser/server boundary:** The choice remains explicitly deferred, while NFR-10 correctly separates preview failure from manufacturing geometry.
- **Core geometry validation:** Explicit units, closed/manifold positive geometry, orientation, wall/feature size, clearances, target size/profile, repair, and bounded regeneration are retained. The remaining loss is slicing, addressed above.
- **Generic text/image-to-3D boundary:** Probabilistic text-to-mesh is excluded from the authoritative Canonical Model, and picture workflows remain outside the MVP. Future image-derived output is required to be labelled as not historically verified.
- **Printer integration phase boundary:** Direct printer connection, fleet control, queues, filament tracking, settings, and cameras remain outside the MVP. The missing future constraints are compatibility/authentication and safe non-interruption, addressed above.
- **Commercial and licensing boundary:** Commercial sales remain contingent on repeatable reliability, and source-licensing assessment remains the user's responsibility.

## Reference Benchmarks Not Carried Forward

The brief addendum's cultural-heritage examples—Recogito, ResearchSpace, and Smithsonian Voyager—are not repeated in the PRD addendum. Manifold WebAssembly and Three.js are also omitted as browser-side geometry and preview references. These omissions do not currently contradict a requirement: the provenance behavior, viewer behavior, and browser/server decision survive elsewhere. Preserve the links in architecture research if comparative evaluation of scholarly annotation, browser manifold operations, or preview/export tooling is expected; otherwise they can remain non-authoritative background references.

## Recommended PRD Disposition

- Add an open question or architecture decision for the authoritative Middot edition, translation, and passage identity.
- Expand the research architecture decisions to include citation-support verification, authority ranking/conflict rules, and confidence representation/calibration.
- Add functional requirements for constrained Personalization, direct visual distinction, and Version comparison.
- Add an explicit slicer decision and qualify the term "print-ready" to match the resulting validation boundary.
- Restore the omitted compatibility, authentication, and non-interruption constraints under deferred printer capabilities, without expanding MVP scope.
