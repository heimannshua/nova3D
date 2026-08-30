---
title: nova3D Brainstorming-to-PRD Reconciliation
status: review-required
created: 2026-08-27
sources:
  - ../../../brainstorming/brainstorm-web-3d-modelling-app-2026-08-26/.memlog.md
  - ../../../brainstorming/brainstorm-web-3d-modelling-app-2026-08-26/brainstorm-intent.md
  - ./prd.md
  - ./addendum.md
---

# Brainstorming-to-PRD Reconciliation

## Purpose and result

This document reconciles the completed brainstorming record and product-intent summary against the current PRD and technical addendum. It looks specifically for qualitative product ideas, user decisions, boundary behavior, and parked capabilities that are missing, weakened, contradicted, or silently transformed.

The PRD strongly preserves the central evidence-to-geometry integrity chain. The main reconciliation work is elsewhere: the personal-only product has become a multi-account MVP; Middot's governing authority and the reconstruction's dated phase are no longer contractual; several future-proofing and printer-fleet invariants have been reduced to broad placeholders; and some review, comparison, traceability, and beginner-language behavior is not testable.

## Reconciliation findings

### R-1 — Personal-only scope is contradicted by a multi-account MVP

**Brainstorming input:** The app is intended only for Josh, not customers or teams; personal scope was explicitly used to eliminate broad onboarding and complex permissions (`.memlog.md:12-14`; `brainstorm-intent.md:7,42`).

**Current treatment:** The PRD calls Josh the sole initial user but introduces trusted invited users, controlled registration, isolated Workspaces, Administrator account controls, Usage Limits, cross-account authorization, shared research caching, and deletion/privacy behavior. These are not merely parked: FR-1 through FR-4, FR-30, and the corresponding NFRs and metrics are in MVP scope (`prd.md:22,38-40,72-108,343-357,374,397-409,418-427`).

**Status:** Contradicted and materially expanded.

**Why it matters:** Identity administration, tenancy isolation, metering, privacy-preserving shared caches, and deletion semantics create a substantial second product track. They consume implementation and verification capacity before the brainstorming record's indispensable research-to-model capability is proven.

**Reconciliation needed:** Choose and record one boundary:

- restore a genuinely single-user MVP and park accounts, registration, per-account limits, shared caches, and cross-account deletion/privacy; or
- explicitly supersede the personal-only decision, explain why invited users are now required in the first milestone, and accept the resulting scope and security obligations.

### R-2 — The indispensable first capability is diluted by unsourced MVP additions

**Brainstorming input:** The indispensable first capability is the complete deep-research-to-automatic-3D chain; everything else follows that proof (`.memlog.md:61-63`; `brainstorm-intent.md:29-31`).

**Current treatment:** The PRD does include the complete chain, but the same MVP also requires multi-account administration, Usage Limits, shared research reuse and deletion semantics, and plain-language Personalization (`prd.md:72-134,223-230,343-357,374-385`). Personalization, invited accounts, per-account cost controls, and a shared cache were not decisions in the brainstorming inputs.

**Status:** Silently reprioritized.

**Why it matters:** The PRD no longer expresses a thin proof of the one indispensable capability. A failed milestone could be caused by ancillary platform work rather than by the core research-to-model thesis.

**Reconciliation needed:** Mark each additive capability as either required to demonstrate the integrity chain or deferred until after that proof. Personal cost visibility may remain without requiring invited Accounts or a shared cross-account cache.

### R-3 — The reconstruction's dated historical phase is missing

**Brainstorming input:** The Second Temple complex changed over centuries, so a precise reconstruction requires selecting a dated historical phase (`.memlog.md:21-22`).

**Current treatment:** The PRD narrows the initial model to Middot chapter 3's outer altar and ramp, but neither Project intake, the Research Plan, source evaluation, nor the Source Record requires a historical phase or date range.

**Status:** Missing.

**Why it matters:** Supplementary textual, archaeological, and scholarly evidence can describe different periods. Without an explicit phase, the system can create a well-cited but historically incoherent composite.

**Reconciliation needed:** Add the governing historical phase/date range to confirmed Project scope, Research Plan identity, source applicability judgments, approval, and Source Record. Require an explicit unresolved/disputed treatment if the phase cannot be fixed confidently.

### R-4 — Middot's governing authority has been weakened to one source among several

**Brainstorming input:** Middot is the primary basis and governing spatial specification; other sources supplement ambiguous or missing details and must be visibly identified as supplementation or inference (`.memlog.md:23-24`; `brainstorm-intent.md:5,19-22`).

**Current treatment:** FR-8 requires finding relevant material in Middot and searching beyond it. FR-9 permits primary texts, commentaries, books, archaeology, and named scholars, but no requirement defines Middot's precedence, when another source may override it, or how supplementation must be labelled (`prd.md:136-153`).

**Status:** Weakened.

**Why it matters:** A recommendation can silently prefer later scholarship or archaeological reconstruction over Middot even when the product's chosen interpretive contract says Middot governs.

**Reconciliation needed:** Add a source-authority rule for this domain: Middot governs spatial claims by default; additions, conflicts, and departures are visibly labelled; any override is a disputed decision requiring explicit reasoning and Plan Approval.

### R-5 — User control over the source corpus has disappeared

**Brainstorming input:** The user supplies or selects source material, and the system researches books and their arguments when Middot is ambiguous (`brainstorm-intent.md:11,19-22`; `.memlog.md:26-28`).

**Current treatment:** FR-5 and FR-8 emphasize starting without finding or uploading texts and automatic source discovery. No requirement lets the user add, exclude, require, or select a Source for the Research Plan (`prd.md:107-115,136-144`).

**Status:** Silently transformed from user-selected plus system-researched sources to system-selected sources.

**Why it matters:** Josh cannot ensure that a trusted edition, commentary, or book is considered, nor exclude a source he regards as inapplicable. This reduces his stated role in directing research.

**Reconciliation needed:** Preserve zero-input automatic discovery while adding source-direction controls: supply or nominate a Source, require consideration, exclude with a recorded reason, and show whether the system could access and evaluate it.

### R-6 — Section-level grouped dossiers became one monolithic whole-project review

**Brainstorming input:** Disputed interpretations are reviewed as grouped sets rather than interrupting generation detail by detail; the proposed unit is a section-level decision dossier with alternatives, citations, recommendation, confidence, and predicted geometry effects (`.memlog.md:29-31`; `brainstorm-intent.md:11,21`).

**Current treatment:** FR-12 requires one complete Project-wide Research Plan and forbids incremental generation while research remains unresolved (`prd.md:171-179`). This preserves a single approval gate but does not require section-level grouping, navigable dossiers, or batch-level review states.

**Status:** Partly preserved, partly silently transformed.

**Why it matters:** A large complete-Temple plan could become an unmanageable flat approval surface even though it technically satisfies whole-project review.

**Reconciliation needed:** Keep whole-plan, version-bound approval while requiring the plan to be organized into section-level dossiers. Permit review progress to be saved by dossier without granting generation authority until the complete plan is approved.

### R-7 — The reusable domain-package architecture is absent as a constraint

**Brainstorming input:** The product should be a reusable source-to-model engine, with Middot as the first domain package rather than the application being hard-coded to one reconstruction; other books and topics later become additional packages (`.memlog.md:45-47`; `brainstorm-intent.md:44-50`).

**Current treatment:** Other research domains are deferred in the PRD and addendum, but neither document requires the MVP's engine/domain separation or defines a domain-package seam (`prd.md:364,393`; `addendum.md:29-34`).

**Status:** Missing architectural invariant; future capability only broadly parked.

**Why it matters:** An altar-and-ramp implementation can satisfy the current PRD while hard-coding Middot-specific extraction, claim types, geometry rules, and validation paths, making the stated later expansion a rewrite.

**Reconciliation needed:** Add a product-level extensibility constraint without prematurely selecting implementation: Middot-specific vocabulary, parsing, adjudication policy, and geometry mappings must be separable from the reusable evidence, approval, provenance, dependency, versioning, and export pipeline. Require an architecture acceptance check for this seam.

### R-8 — Version comparison is described but not required

**Brainstorming input:** Saved versions are intended to let interpretations be compared and earlier geometry restored (`.memlog.md:39-43`; `brainstorm-intent.md:28`).

**Current treatment:** Section 4.4 says the user "compares outcomes," but FR-22 only requires viewing and restoring prior Versions. No functional requirement defines geometry, parameter, interpretation, or evidence differences between two Versions (`prd.md:233,268-278`).

**Status:** Weakened and not testable.

**Why it matters:** A history list and restore action do not let the user understand how competing interpretations changed the model.

**Reconciliation needed:** Either remove the comparison claim or add a version comparison requirement showing at least changed interpretations, affected parameters/features, and a usable visual or structured geometry difference.

### R-9 — Beginner-friendly language is not a cross-cutting behavior

**Brainstorming input:** Use concrete beginner-friendly language, explain modelling and development jargon, and hide modelling/file-format complexity (`.memlog.md:33-35,68-69`; `brainstorm-intent.md:7`).

**Current treatment:** The target-user section repeats the need, and NFR-8 applies beginner-friendly language to failures, but research decisions, confidence explanations, geometry, validation, repair, export, and printer terminology have no corresponding requirement (`prd.md:22,405`).

**Status:** Weakened from product-wide direction to descriptive intent plus failure copy.

**Why it matters:** The app can conform while exposing unexplained terms such as manifold edges, nondegenerate geometry, canonical representation, or reproducibility tolerance at its main decision points.

**Reconciliation needed:** Add a cross-cutting usability requirement: user-facing modelling, research, validation, and file-format terms use plain language, explain necessary jargon in context, and keep underlying representation details behind progressive disclosure.

### R-10 — "Every generated feature" is not guaranteed to be traceable and selectable

**Brainstorming input:** Every object, measurement, material, placement, and modelling decision must link to exact sources, alternatives, confidence, and approval; clicking a model part reveals that context (`.memlog.md:15-16,63-66`; `brainstorm-intent.md:13-15,25`).

**Current treatment:** The PRD guarantees coverage for every **Consequential Detail** and rich evidence for a selected **Model Feature**, but it does not explicitly require every generated object/part and every consequential property to be represented by a selectable Model Feature. The shift from "every" to the defined consequential subset is otherwise thoughtful (`prd.md:49-60,155-179,245-253`).

**Status:** Potentially weakened at the geometry-to-evidence join.

**Why it matters:** The research record can be complete while some visible geometry cannot be selected or traced back from the viewer, breaking the promised interaction in the exact place the user discovers a questionable part.

**Reconciliation needed:** Require total mapping in both directions: every generated object/part and consequential property maps to its Claims/decision/status, and every such Claim/decision maps to affected parameters and Model Features. Define explicit viewer behavior for geometry that cannot be selected directly.

### R-11 — The initial domain was narrowed without a recorded acceptance decision

**Brainstorming input:** The initial reconstruction domain is the Second Temple and its sacred utensils (`.memlog.md:19-21`; `brainstorm-intent.md:5`).

**Current treatment:** The first implementation is the outer altar and ramp from Middot chapter 3; the complete Temple and utensils are explicitly deferred (`prd.md:16,359-360,375,389-390`; `addendum.md:30`).

**Status:** Transparently documented in the PRD, but silently transformed relative to the brainstorming decisions.

**Why it matters:** The cut is sensible for buildability, but the source record does not show whether the user accepted altar-and-ramp as the proof slice or what must be demonstrated before expansion.

**Reconciliation needed:** Record altar-and-ramp as the accepted vertical slice of the unchanged Second-Temple-and-utensils domain, and state the exit criteria for proceeding to complete Temple and utensil coverage.

### R-12 — Deferred printer support loses its safety and routing contract

**Brainstorming input:** After inspection and confirmation, nova3D connects to multiple personal printers; automatically chooses the best suitable printer using model requirements, build dimensions, capabilities, loaded filament colour/material, availability, and queue time; queues when unavailable; never interrupts an active print; and exposes settings, fleet status, queues, filament state, and cameras (`.memlog.md:49-60`; `brainstorm-intent.md:33-35`).

**Current treatment:** Printer integration is correctly out of the MVP. The addendum retains direct control, multi-printer queues, device and filament state, explainable routing, settings, and cameras, while the PRD protects the provenance record from later printer integration (`prd.md:362,400`; `addendum.md:12,32`). It does not retain the no-interruption invariant, automatic-best-printer decision, complete routing inputs, loaded colour/material distinction, unavailable-printer queue behavior, or the inspection-and-confirmation gate.

**Status:** Parked but materially under-specified.

**Why it matters:** A future implementation could satisfy the parked bullet while pre-empting a live print, routing to an unsuitable printer, or submitting without the explicit confirmation the brainstorming record requires.

**Reconciliation needed:** Preserve the deferred behavior as an explicit future contract, even while excluding implementation from MVP:

- submission follows inspection and Model Approval/confirmation;
- active jobs are never interrupted automatically;
- unsuitable or unavailable printers cause safe queuing, not pre-emption;
- automatic routing considers build envelope, model/profile requirements, capabilities, loaded material and colour, availability, and expected queue time;
- the routing decision and any inability to route are explained.

## Decisions and ideas preserved strongly

The following brainstorming content is materially present and does not need corrective reconciliation:

| Brainstorming intent | Current PRD treatment |
| --- | --- |
| No manual modelling; system owns geometry generation | FR-15 and the manual-editing non-goal preserve automatic generation. |
| Complete traceability instead of false certainty | Vision, Detail Status, FR-10 through FR-13, FR-19, NFR-3, and SM-2 preserve the integrity principle. |
| Explicit sourced, inferred, disputed, and unknown states | The Detail Status enum preserves all four and adds the useful `user-added` state. |
| Human approval before disputed interpretations become geometry | Version-bound Plan Approval blocks generation in FR-13 and FR-15. |
| Record chosen and rejected options, citations, confidence/reasoning, approver, and effects | The Research Plan, Plan Approval, feature evidence view, and Source Record collectively preserve the approval ledger. |
| Dependency-aware regeneration after focused re-research | FR-20 and FR-21 preserve targeted correction, approval, affected rebuilds, and unchanged unrelated geometry. |
| Read-only inspection instead of direct mesh editing | FR-18 preserves rotation, pan, zoom, section views, hiding/isolation, and measurement. |
| Restorable approved/regenerated model history | FR-21, FR-22, FR-27, and FR-28 preserve non-destructive Version history and restoration. |
| Validated, print-ready file as the visible outcome | FR-24 through FR-29 preserve profile-qualified validation, bounded repair/regeneration, and approved export. |
| Inspect before fabrication | Version-bound Model Approval gates Export and later printing. |
| Model rather than images, video, or sales collateral as the product output | Picture workflows and sales workflows remain outside MVP; the Source Record is supporting provenance required by the integrity promise, not a separate content product. |
| Private workspaces and no public marketplace/team collaboration | Public registration, shared Projects, teams, billing, storefronts, marketplaces, and sales-listing generation remain non-goals, notwithstanding R-1's invited-account conflict. |
| Intended React/Tailwind/Vercel/Supabase/Upstash/GitHub direction | The addendum preserves the stack as constraints for architecture to evaluate rather than forcing every service into the design. |
| Commercially saleable outputs and broader model types are later goals | The addendum explicitly parks other subjects/model types and commercial sale until repeatable reliability is demonstrated. |

## Recommended PRD disposition

The PRD should not absorb every parked capability into MVP requirements. The smallest reconciliation is to:

1. obtain explicit acceptance for the altar-and-ramp vertical slice and decide whether the MVP is truly single-user;
2. add the dated-phase and Middot-governance rules to the evidence contract;
3. restore source-direction, section-dossier, total feature-to-evidence mapping, version-comparison, and beginner-language behavior as testable requirements where intended;
4. add the reusable engine/domain-package boundary to architecture acceptance criteria; and
5. retain printer safety and automatic-routing invariants in the deferred-capability record without pulling printer implementation into the MVP.

Until R-1 and R-4 are explicitly resolved, the PRD can produce a technically compliant milestone that differs materially from the product approved in brainstorming.
