---
title: nova3D Product Brief Reconciliation
status: complete
created: 2026-08-27
source: ../../briefs/brief-nova3D-2026-08-27/brief.md
targets:
  - prd.md
  - addendum.md
---

# Product Brief Reconciliation

## Reconciliation Result

The PRD and addendum preserve the brief's central product promise well: a private browser experience that turns evidence into a complete, approved interpretation plan; generates reproducible geometry only after plan approval; keeps consequential details traceable; supports evidence-led correction and dependency-aware regeneration; validates a print-specific export; and retains provenance rather than claiming impossible historical certainty.

The principal reconciliation problem is scope and authority drift. The brief defines Josh as the initial and only application user and makes the altar-and-ramp integrity chain, including one personalized variation, the narrow first milestone. The PRD instead puts a multi-account administration and cost-control platform into MVP scope, adds several workflow gates and operating subsystems without identifying them as later decisions, and removes the brief's explicit source-selection starting point. These may be valid later product decisions, but they are not faithful translations unless the brief has been explicitly superseded.

## Meaningful Gaps and Transformations

### R-1 — The sole-user MVP became a multi-account platform

**Classification:** Contradicted and materially expanded.

**Brief intent:** The "initial and only application user is Josh" and nova3D is a practical personal tool for his own use (`brief.md`, Executive Summary and Who This Serves; lines 16 and 20). Collaboration, billing, and other customer-facing concerns are outside the first milestone (`brief.md`, First Milestone Boundary; line 50).

**Current treatment:** The PRD calls Josh the primary user rather than the only user, introduces trusted invited users, makes Josh an Administrator, gives every Account an isolated Workspace, and places controlled registration, Account status, Usage Limits, administrative usage visibility, and cross-account isolation in the MVP (`prd.md`, Target User, UJ-2, FR-1–FR-4, MVP Scope, NFR-1/NFR-2/NFR-9/NFR-12).

**Why this matters:** This changes the first product from a private single-user reconstruction tool into a hosted multi-tenant service. It creates substantial authentication, authorization, privacy, administration, cost-accounting, and deletion work before the brief's first proof is complete. Separate private Workspaces do not make the change compatible with "initial and only application user."

**Reconciliation needed:** Either defer invited Accounts, Registration Credentials, Administrator controls, per-Account Usage Limits, and cross-account behavior until after the altar-and-ramp proof, or record an explicit approved supersession of the brief's sole-user decision and re-baseline milestone scope and success criteria.

### R-2 — Unapproved platform capabilities are embedded in the first milestone

**Classification:** Silently expanded.

**Brief intent:** The first milestone proves one end-to-end altar-and-ramp workflow, including research, approval, deterministic generation, inspection, correction, a personalized variation, validation, export, and source record (`brief.md`, First Milestone Boundary and Build Direction; lines 48 and 73).

**Current treatment:** In addition to the multi-account system, the PRD makes concurrent Jobs, app-wide Notifications, paid/free research modes, usage accounting, shared research caching, permanent Project deletion semantics, profile-qualified repair behavior, and a bounded full-regeneration fallback part of MVP (`prd.md`, FR-6, FR-7, FR-14, FR-24–FR-28, FR-30, and §6.1).

**Why this matters:** Some of these are sensible enabling requirements, especially print qualification and safe background work. Collectively, however, they materially enlarge the first build and are not traceable to the brief's milestone decision. The expansion weakens the brief's instruction to preserve one lean end-to-end integrity chain instead of building disconnected feature surfaces.

**Reconciliation needed:** Classify each added subsystem as either essential to the first proof or deferred. Keep only the minimum Job durability and validation behavior required to complete the altar-and-ramp journey; move platform administration, shared cache, broad concurrency, and similar operational capabilities to an explicitly later slice unless separately approved.

### R-3 — User selection of source material has disappeared from intake

**Classification:** Missing and silently transformed.

**Brief intent:** The user starts a Project by choosing the source material and describing the desired outcome; nova3D then reads the relevant material and expands research only where needed (`brief.md`, Solution Experience; line 40).

**Current treatment:** FR-5 starts from an ordinary-language desired model, explicitly "without finding or uploading source texts," and FR-8 makes subject and source discovery automatic. No requirement preserves the user's ability to select, supply, pin, or constrain the governing source material.

**Why this matters:** Automatic discovery is useful, but it is not equivalent to user-directed source selection. For a source-governed reconstruction, choosing the governing corpus is an interpretive control. Its loss can make a Project begin from the wrong edition, translation, passage set, or authority boundary while still appearing fully automated.

**Reconciliation needed:** Restore an intake capability to select, provide, or confirm the governing source set. Automatic discovery should supplement that set and remain available when the user provides only a goal; it should not erase user authority over the starting material.

### R-4 — The gap-triggered research invariant is weakened by unconditional fresh research

**Classification:** Weakened and potentially contradicted.

**Brief intent:** Explicit source descriptions become modelling rules, and broader research occurs only when details are missing, ambiguous, or disputed (`brief.md`, Executive Summary and Solution Experience; lines 14 and 40).

**Current treatment:** FR-8 preserves the missing/conflicting/ambiguous trigger for searching beyond Middot, but FR-14 also asks the user before research whether to reuse cache or research the subject again from scratch. The latter path is not tied to a gap, dispute, stale source, or explicit re-verification need.

**Why this matters:** "Research from scratch" can turn a constrained evidence-expansion rule into a broad default research pass, increasing cost and making it harder to distinguish source extraction from supplementary interpretation. It also conflicts with the product's intended discipline: use explicit evidence directly, then research the unresolved remainder.

**Reconciliation needed:** Define the pipeline as governing-source extraction first, coverage analysis second, and supplementary research third. Permit a user-requested refresh or re-verification, but label it as an explicit override and record why it was run; do not silently replace the brief's gap-triggered default.

### R-5 — Unknown details do not have a fully reconciled approval path

**Classification:** Weakened through an unresolved branch.

**Brief intent:** The system identifies every unresolved detail, presents clear defensible options wherever evidence cannot settle a required detail, and lets the user choose before Plan Approval. Traceability, not false certainty, is the promise (`brief.md`, Executive Summary, Solution Experience, and Success Criteria).

**Current treatment:** FR-10 allows an explicit `unknown` Detail Status; FR-11 requires the user to choose an option when evidence cannot settle the detail; FR-14 says blocking gaps leave the Project unready for Plan Approval. The PRD never defines when an `unknown` is an approvable, explicitly modelled choice versus a blocking gap.

**Why this matters:** The system can either block indefinitely even when a transparent fabrication choice would satisfy the brief, or allow geometry while an unresolved detail lacks a defensible treatment. Both outcomes undermine the intended balance between honest uncertainty and practical reconstruction.

**Reconciliation needed:** Define two states explicitly: (1) unresolved evidence with at least one transparent, renderable treatment that the user may approve as inferred/unknown, and (2) a blocking gap for which no responsible geometry treatment exists. Plan Approval must record the chosen treatment without upgrading its historical certainty.

### R-6 — A second mandatory approval gate was introduced without source authority

**Classification:** Silently transformed.

**Brief intent:** The complete research and interpretation plan is approved before geometry generation. The user then inspects, corrects, and exports a validated result, but the brief does not establish a second formal approval gate (`brief.md`, Executive Summary, Solution Experience, First Milestone Boundary, and Success Criteria).

**Current treatment:** The PRD introduces `Model Approval` as a separate version-bound authorization and blocks Export until it exists (`prd.md`, Vision line 18, UJ-1, glossary, FR-23, FR-27–FR-29, SM-3).

**Why this matters:** This is a defensible safety and audit choice, but it changes the user journey, state model, repair flow, and acceptance tests. Treating it as a translation of the brief conceals a material product decision.

**Reconciliation needed:** Either mark version-bound Model Approval as an explicitly approved elaboration, or return to the brief's semantics in which inspection/correction plus passing validation makes export available. If retained, clarify whether a restored Version's historic approval is evidence only or current export authority; FR-22 currently says it retains original approval states but may need a new approval.

### R-7 — The required personalized milestone proof is no longer independently testable

**Classification:** Weakened.

**Brief intent:** The first milestone includes a plain-language personalization test and the first build proves one personalized variation (`brief.md`, Executive Summary line 16 and Build Direction line 73). The personalized geometry must remain clearly distinct and printable.

**Current treatment:** FR-17 correctly defines automatic, user-added Personalization and carries it through inspection, versioning, approval, and validation. However, no success metric requires the altar-and-ramp milestone to exercise a personalization request. SM-1 can be satisfied by an unpersonalized Project, and its broad reference to FR-8 through FR-29 does not state that every optional path must be executed.

**Why this matters:** The milestone can be declared successful without proving one of the brief's explicit differentiating outcomes.

**Reconciliation needed:** Add a dedicated acceptance metric: one ordinary-language personalization request produces visibly user-added geometry automatically, preserves the historical evidence classification of the base model, and passes the selected Target Print Profile validation without manual modelling.

### R-8 — Beginner-friendly guidance was reduced to beginner-friendly language

**Classification:** Weakened.

**Brief intent:** Josh needs beginner-friendly guidance throughout a workflow he cannot perform manually (`brief.md`, Who This Serves; line 20).

**Current treatment:** The Target User section mentions beginner-friendly language, and FR-6/NFR-8 require understandable failure explanations. No functional or quality requirement covers guidance when confirming scope, comparing interpretations, choosing a print profile, responding to validation warnings, or deciding whether to research again.

**Why this matters:** Plain wording alone does not help a first-time developer and non-modeller make unfamiliar evidence, geometry, and fabrication decisions. The interface may be technically transparent but operationally inaccessible.

**Reconciliation needed:** Add a cross-cutting guided-decision requirement: every user decision explains what is being chosen, why it matters, the likely model or cost effect, and a safe next action, without requiring CAD or research expertise.

### R-9 — The Second Temple remains listed, but its strategic priority is weakened

**Classification:** Weakened.

**Brief intent:** The first major outcome is the complete Second Temple and its utensils; the altar and ramp are the deliberately narrow first development model (`brief.md`, Executive Summary). The same evidence and geometry system then expands section by section until it reaches that outcome (`brief.md`, Build Direction; line 74).

**Current treatment:** The PRD correctly excludes the complete Temple and utensils from MVP, but the addendum lists them as one deferred capability beside picture workflows, printer control, other domains, and sales. It does not preserve "first major outcome," section-by-section expansion, or reuse of the same governed system as a sequencing constraint.

**Why this matters:** Later planning could prioritize unrelated domains or picture workflows immediately after MVP and still appear consistent with the current PRD package, even though that would depart from the brief's chosen proving path.

**Reconciliation needed:** Restore the roadmap invariant: after the altar-and-ramp proof, expand the same evidence-to-geometry chain section by section toward the complete Temple and utensils before generalizing to unrelated domains.

### R-10 — The ordered build sequence was flattened into an unordered capability list

**Classification:** Silently weakened.

**Brief intent:** The brief gives a five-step sequence: altar-and-ramp plus personalization; section-by-section complete Temple and utensils; direct printer control and fleet capabilities; generalization to other sources and model types; then sales only after repeatable quality across multiple outputs (`brief.md`, Build Direction; lines 71–77).

**Current treatment:** `addendum.md` preserves most of the capability names and keeps sales behind repeatable reliability, but its Deferred Product Capabilities list does not retain the full ordering. It also introduces picture workflows into that list without stating where they fit.

**Why this matters:** A list of deferred items is not an ordered product strategy. Dependencies that the brief treated as deliberate gates can be rearranged without an explicit product decision.

**Reconciliation needed:** Reproduce the ordered sequence in the PRD package, marking any new capability such as picture workflows as unsequenced until deliberately placed.

## Material Additions That Need Explicit Authority

The following additions are internally plausible but are not decisions present in the product brief. They should be kept only if they came from another approved input or are explicitly accepted as PRD elaborations:

- Trusted invited Accounts, Administrator status, Registration Credential rotation, per-Account usage visibility, disabling Accounts, and multi-tenant isolation.
- Paid/free research mode, Usage Limits, cost reconciliation, and cache-reuse versus fresh-research choice.
- Concurrent multi-Project Jobs and an app-wide Notification bar.
- Shared source-derived research cache and permanent Project deletion semantics.
- Separate version-bound Model Approval after Plan Approval.
- Target Print Profiles, automatic local repair, and one constrained full-regeneration fallback.
- Direct picture-to-model and research-assisted picture reconstruction as a named deferred capability.

This list is not an instruction to delete those ideas. It is an authority check: none should silently redefine the brief-derived milestone.

## Preserved Intent

No reconciliation change is needed for these brief decisions:

- Private browser-based evidence-to-fabrication positioning and no-manual-modelling goal.
- Outer altar and ramp from Middot chapter 3 as the first implementation.
- Complete Consequential Detail coverage and explicit sourced, inferred, disputed, unknown, or user-added classification.
- Low-authority pages as leads only, with recommendations grounded in directly inspectable higher-authority sources.
- Complete whole-Project research review and version-bound Plan Approval before any geometry generation.
- Reproducible Canonical Model separated from probabilistic research or drafting output.
- Feature-level inspection of Claims, Sources, alternatives, reasoning, confidence, approval, and affected parameters.
- Focused correction, new Plan version and approval when interpretation changes, dependency-aware regeneration, and restorable Model Versions.
- User-added Personalization kept separate from historical status and included in inspection and validation.
- Print validation qualified to a named profile, with no promise of universal manufacturability or safety.
- Export of a print-ready model together with a comprehensive Source Record.
- Complete Temple generation, direct printer control, other domains, and commercial sales deferred beyond MVP; no customer-facing marketplace.
- Commercial source-licensing assessment remains the user's responsibility while nova3D records provenance.
- React, Tailwind, Vercel, Supabase, conditional Upstash use, and GitHub are preserved in the addendum as architecture constraints rather than product behavior.

## Recommended Reconciliation Order

1. Decide whether the sole-user brief or the multi-account PRD is authoritative for MVP; this determines a large portion of the implementation surface.
2. Restore user control over the governing source material and define supplementary research as gap-triggered by default.
3. Resolve the `unknown` versus `blocking gap` approval path so historical uncertainty never becomes either false certainty or an unnecessary dead end.
4. Explicitly accept or remove the second Model Approval gate.
5. Add a measurable personalized-variation acceptance test and guided-decision requirement.
6. Reinstate the ordered roadmap and the complete Temple-and-utensils outcome as the next primary domain expansion.
