# PRD Quality Review — nova3D

## Final resolution status — 2026-08-27

**PASS.** After remediation and editorial cleanup, the final CRITICAL/HIGH-only re-review found no unresolved critical or high PRD-quality findings. The original review below is retained as the audit trail that drove the changes. The user's explicit decision to keep all 30 functional requirements in the MVP remains a documented scope override.

## Overall verdict

This is a substantive, unusually coherent PRD: its evidence-to-geometry thesis, two approval gates, provenance chain, and honest limits are strong enough to anchor downstream work. It is not yet a build-ready first milestone, because the MVP combines the core proof with a multi-account platform while core completion, reproducibility, and print-validation gates remain unresolved or self-referential. Use it as the product spine, but cut the first slice and resolve or explicitly assign the phase-blocking acceptance decisions before UX, architecture, and story decomposition.

## Decision-readiness — adequate

The PRD makes several consequential choices plainly. The Vision chooses “complete traceability rather than impossible historical certainty” (§1); FR-12 rejects incremental generation in favor of one whole-project approval boundary; FR-28 limits automatic full regeneration to “at most one”; and §5 explicitly rejects manual modelling, universal manufacturability claims, and probabilistic text-to-mesh as the Canonical Model. Those are real decisions with visible trade-offs, not neutral considerations.

The nine questions in §9 are also genuinely open rather than rhetorical. The remaining weakness is handoff gating: §10 collectively calls them “phase-blocking open questions,” but neither section says which phase each blocks, who decides it, or which questions architecture is authorized to resolve without returning to the product owner.

### Findings

- **high** Phase blockers are listed but not decision-gated (§9 Open Questions; §10 Assumptions Index) — Questions such as the equivalence tolerance (OQ-2), print thresholds (OQ-3), browser/performance target (OQ-6), and deletion semantics (OQ-9) govern acceptance of core requirements, yet the downstream reader cannot tell when or by whom they must be closed. *Fix:* Add an owner, decision deadline/gate, affected FRs/NFRs, and “product decision vs. architecture decision” classification to each OQ.

## Substance over theater — strong

The content is earned and product-specific. The Vision names a concrete first reconstruction (the outer altar and ramp from Middot chapter 3), the two journeys drive distinct capabilities, and the NFRs address actual failure modes such as stale concurrent results, provenance mutation, browser-preview separation, cost authorization, and cache privacy (§§2, 4, 7). The Success Metrics and Counter-Metrics resist vanity measures: for example, SM-C1 says “Source count is not quality,” while SM-C3 forbids improving pass rate by weakening validation.

Nothing substantial reads as persona, innovation, NFR, or vision furniture. The document is long for a solo project, but most of that length carries behavior or constraints; the scope problem is substantive rather than cosmetic.

## Strategic coherence — adequate

The central thesis is clear and repeated consistently: every Consequential Detail must be traceable to evidence or an explicit status, interpretation is approved before geometry, and the exact Model Version is approved before export (§§1, 4.2–4.5). SM-1 through SM-5 validate that arc, and the counter-metrics directly protect it from shortcuts.

The weaker branch is trusted-user administration and shared-cache governance. UJ-2, FR-1 through FR-4, and FR-30 form a second platform thesis beside the altar-and-ramp proof, even though §2 says Josh is the “sole initial user and developer” and trusted users “may later” receive Workspaces. That branch does not invalidate the core strategy, but it dilutes prioritization; the resulting scope risk is detailed under Scope honesty.

## Done-ness clarity — thin

Most FRs are materially better than feature labels: they include observable consequences, invalidation rules, failure states, audit requirements, and bounded retry behavior. FR-13, FR-23, FR-27, and FR-28 are especially clear about which version is authorized and when a new approval is required.

However, several load-bearing success conditions cannot yet be tested without inventing the standard during implementation. The gaps sit in the heart of the product—evidence completeness, reproducibility, print qualification, cost reconciliation, and responsiveness—so they prevent story-level acceptance despite the otherwise strong requirement structure.

### Findings

- **high** Evidence completeness is self-referential (§4.2 FR-10; §8 SM-2) — FR-10 requires “every Consequential Detail needed for the complete requested Model,” while SM-2 measures 100% of the details that made it into the approved plan. Neither defines how the system or reviewer knows that a consequential detail was omitted altogether, so a partial inventory can score 100%. *Fix:* Define the altar-and-ramp coverage method and independent completion check—for example, a finite detail taxonomy/checklist, required source-pass protocol, and review rule for declaring the inventory complete.
- **high** Core quality gates depend on unresolved quantities (§4.3 FR-16; §4.5 FR-25; §8 SM-4–SM-5; §9 OQ-2–OQ-3) — “geometrically equivalent output within a defined tolerance” has no tolerance, and “passes all supported blocking checks” has no initial profile-specific thresholds. These are the acceptance gates for reproducibility and export, not incidental implementation details. *Fix:* Before story decomposition, name the initial printer/material/size profile, its blocking validation thresholds, the equivalence method and tolerance, and representative pass/fail fixtures; architecture may propose them, but product acceptance must ratify them.
- **medium** Two NFRs remain adjective-level (§7 NFR-9–NFR-10) — Usage records must reconcile “closely enough,” and the workspace must be “Responsive” without response-time, workload, or degradation bounds. *Fix:* Give each a test procedure and budget, even a pragmatic solo-MVP one (sample workload, percentile or maximum wait, reconciliation unit/tolerance, and acceptable degraded viewer behavior).

## Scope honesty — thin

The PRD is candid about exclusions. §§5–6 clearly defer the complete Temple, printer control, picture workflows, broader domains, collaboration, commerce, and safety certification, and the addendum preserves a sensible expansion order.

What remains labeled MVP is still far larger than the stated “first implementable nova3D milestone” for one first-time solo developer (§0, §2). It combines a research/provenance engine, deterministic parametric geometry, a rich evidence-linked 3D viewer, dependency-aware correction and version comparison, print validation/repair/export, and a private multi-account service. The document is honest about features but not yet honest about the sequence needed to prove them.

### Findings

- **high** The MVP lacks a smallest end-to-end proof slice (§6.1 In Scope) — The first milestone simultaneously requires controlled Accounts and Usage Limits, concurrent Jobs and Notifications, complete source discovery, explainable research, reproducible generation, interactive inspection, dependency-aware regeneration, version restoration, automatic print repair, provenance export, deletion, and shared cache reuse. For a “serious solo passion project,” this makes feasibility and learning arrive too late. *Fix:* Define a first vertical proof that takes one fixed altar-and-ramp corpus through evidence classification, one approval, deterministic geometry, basic inspection, validation, and export; move invited Accounts, usage administration, shared cache/deletion, concurrency beyond one active Job, and advanced repair/version comparison behind explicit later gates unless each is required to validate the thesis.
- **medium** “Permanently delete” is not yet a coherent user promise (§4.6 FR-30; §9 OQ-8–OQ-9) — FR-30 promises permanent deletion while allowing retained source-derived Claims and leaving backup retention and deletion verification unresolved. A user cannot infer what disappears immediately, what ages out, and what is irreversibly retained in de-identified form. *Fix:* Split the contract into Project deletion, backup expiry, and shared-evidence retention; state each artifact class, visibility, retention period or decision owner, and verification behavior.

## Downstream usability — adequate

The artifact is unusually extractable. The Glossary defines the core domain nouns, FR-1 through FR-30 are contiguous and grouped, the two UJs have a named protagonist, SMs point back to requirement ranges, and the addendum cleanly separates intended platform constraints from product behavior (§§2–4, 8; addendum §§Intended Platform Choices–Architecture Decisions Deferred). Architecture and story workflows can source most invariants without reconstructing the product thesis.

UX is the least-served downstream consumer. UJ-1 compresses intake, research progress, a dense evidence review, interpretation choice, generation, spatial inspection, correction, reapproval, and export into one paragraph; the FRs add behaviors but not enough session context to settle information hierarchy, interruption/recovery, or progressive disclosure.

### Findings

- **medium** The load-bearing UX journey is too compressed for clean extraction (§2.3 UJ-1; §§4.1–4.5) — “Josh turns Middot into an approved printable model” names the happy path, but omits the lived branches created by free-only research gaps, failed/cancelled Jobs, disputed-detail overload, correction invalidation, validation warnings, repair, and restored Versions. UX would have to invent how Josh understands and recovers from the product’s defining uncertainty. *Fix:* Add a small set of named, narrative journeys or journey variants for research-plan review, interruption/failure recovery, evidence-led correction, and validation/repair, each ending in a clear user outcome; keep detailed screens for the UX specification.

## Shape fit — adequate

This is a meaningful-UX, chain-top PRD, so named journeys, a glossary, stable IDs, and explicit cross-cutting constraints are justified even for a solo passion project. The capability-oriented FR structure fits the technical heart of the product, while the addendum correctly carries React, Vercel, Supabase, Upstash, canonical-geometry candidates, and other implementation context outside the behavioral contract.

The document is more formal than the usual solo PRD, but the form largely earns its keep because it feeds UX, architecture, and stories. Its fit becomes strong once the MVP is cut to an executable proof and the complex interaction branches are represented in the journeys; those substantive issues are already captured above.

## Mechanical notes

- FR-1 through FR-30, UJ-1 through UJ-2, SM-1 through SM-10, SM-C1 through SM-C4, and OQ-1 through OQ-9 are contiguous and unique; sampled cross-references resolve.
- The Assumptions Index roundtrips cleanly: there are no inline `[ASSUMPTION]` tags and the index claims none.
- Both UJs name Josh as protagonist. UJ-2's secondary actor is only “the person”; name that invited-user context if UX will design the registration side of the journey.
- Minor glossary drift: the defined term is **Model Version**, but the PRD often capitalizes the shorthand **Version** as though independently defined; SM-10 uses **Consequential Model Feature**, while the glossary defines **Consequential Detail** and **Model Feature** separately. Normalize or explicitly define these terms before machine extraction.
- Required sections are present for the stated product type and downstream use. No broken local document cross-references were found.
